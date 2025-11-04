// TODO:
// add refresh chart button/function that redoes note/accuracy calculations (don't need to redo frequency) and re-renders chart
// try visualizing doppler effect

const debugShowAllNotes = false; // Display all notes including low clarity ones in chart

// Import the PitchDetector class from the pitchy ES Module
import { PitchDetector } from 'https://esm.sh/pitchy@4.1.0';

// DOM Elements
const statusElement = document.getElementById('status');
const recordBtn = document.getElementById('recordBtn');
//const playBtn = document.getElementById('playBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const micRecordBtn = document.getElementById('micRecordBtn');
const fileNameDisplay = document.getElementById('fileNameDisplay');
const downloadRecordingBtn = document.getElementById('downloadRecordingBtn');
const audioPlayer = document.getElementById('audioPlayer');
const historyLog = document.getElementById('historyLog');
const fileInput = document.getElementById('fileInput');
const accuracyChartCanvas = document.getElementById('accuracyChart');
const useCentsToggle = document.getElementById('useCentsToggle');
const standardPitchInput = document.getElementById('standardPitchInput');
const submitPitchBtn = document.getElementById('submitPitchBtn');

if (micRecordBtn) {
    micRecordBtn.addEventListener('click', handleMicRecordClick);
}
if (downloadRecordingBtn) {
    downloadRecordingBtn.addEventListener('click', downloadLatestRecording);
}

// Audio & Recording Constants
const LIVE_SAMPLE_RATE = 16000;
const RECORD_DURATION_MS = 5000;
const ANALYSIS_BUFFER_SIZE = 2048;

// WebSocket variables
let isRecording = false;
let audioWSChunks = []; 

// Microphone recording variables
let mediaRecorder = null;
let micStream = null;
let micChunks = [];
let micInitPromise = null;

// Latest WS/mic recording data
let latestRecordingBlob = null;
let latestRecordingUrl = null;
let downloadAnchor = null;

// Analysis variables
let accuracyHistory = [];
let pitchyDetector;
let audioContext;
let accuracyChart;
let playheadAnimationId = null;


// Note and frequency data
let A4 = 440; // Want to keep current A4 value accessible
const noteNames = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
let standardFrequencies = {};
let sortedFreqs = [];
function generateStandardFrequencies() {
    standardFrequencies = {};
    //sortedFreqs = [];
    for (let i = 0; i < 88; i++) {
        const freq = A4 * Math.pow(2, (i - 48) / 12);
        const octave = Math.floor((i + 9) / 12); //change - remove -1
        const noteName = noteNames[i % 12];
        standardFrequencies[freq] = `${noteName}${octave}`;
    }
    sortedFreqs = Object.keys(standardFrequencies).map(Number).sort((a, b) => a - b);
}
generateStandardFrequencies(); // Move this default initialization somewhere else?

// 
function cleanupLatestRecordingUrl() {
    if (latestRecordingUrl) {
        URL.revokeObjectURL(latestRecordingUrl);
        latestRecordingUrl = null;
    }
}

function handleRecordedAudio(blob, source) {
    // keep the latest blob around for playback/download
    latestRecordingBlob = blob;
    cleanupLatestRecordingUrl();
    latestRecordingUrl = URL.createObjectURL(blob);

    audioPlayer.src = latestRecordingUrl;
    audioPlayer.load();              // force reload so the new clip is ready
    //playBtn.disabled = false;
    downloadRecordingBtn.disabled = false;

    // tailor the UI copy a bit
    if (source === 'liveWS') {
        //statusElement.textContent = 'Live recording ready.';
        displayHistory(accuracyHistory, 'live');
    } else if (source === 'microphone') {
        //statusElement.textContent = 'Microphone recording ready.';
        displayHistory(accuracyHistory, 'microphone');
    }

    historyLog.innerHTML = historyLog.innerHTML || 'Recording analyzed successfully.';
}

// --- WEBSOCKET SETUP ---
const ws = new WebSocket(`ws://${window.location.host}`);
ws.binaryType = 'arraybuffer';

ws.onopen = () => {
    console.log('WebSocket connection opened');
    statusElement.textContent = 'Connected';
    statusElement.style.color = 'green';
};

ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
        const pcmData = new Int16Array(event.data);
        if (isRecording) {
            audioWSChunks.push(pcmData);
            const analysisResult = analyzePitch(pcmData, LIVE_SAMPLE_RATE);
            const time = (audioWSChunks.length * pcmData.length / LIVE_SAMPLE_RATE).toFixed(2);
            accuracyHistory.push({ time, ...analysisResult });
        }
    }
};

ws.onclose = () => {
    console.log('WebSocket connection closed');
    statusElement.textContent = 'Disconnected';
    statusElement.style.color = 'red';
};

// --- PITCH DETECTION & ANALYSIS ---
window.addEventListener('load', () => {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    // Use the imported PitchDetector directly
    pitchyDetector = PitchDetector.forFloat32Array(ANALYSIS_BUFFER_SIZE);
});

function analyzePitch(pcmData, sampleRate) {
    if (!pitchyDetector) return { pitch: 0, noteName: 'N/A', cents: 0, accuracy: null, hasValidPitch: false };

    let pcmFloat32Data;
    if (pcmData instanceof Int16Array) {
        pcmFloat32Data = new Float32Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
            pcmFloat32Data[i] = pcmData[i] / 32768.0;
        }
    } else {
        pcmFloat32Data = pcmData;
    }

    const [pitch, clarity] = pitchyDetector.findPitch(pcmFloat32Data, sampleRate);

    // Lowered clarity threshold for better detection of pure tones
    if (clarity > 0.9) {
        const { targetFreq, noteName } = findClosestNote(pitch);
        const cents = 1200 * Math.log2(pitch / targetFreq);
        const accuracy = Math.max(0, 100 - (Math.abs(cents) * 2));

        return { 
            pitch: pitch.toFixed(1), 
            noteName, 
            cents: cents.toFixed(1), 
            accuracy: accuracy.toFixed(0),
            hasValidPitch: true,
            clarity: clarity
        };
    }
    
    // Return low clarity indicator
    return { 
        pitch: 0, 
        noteName: 'N/A', 
        cents: (debugShowAllNotes ? 0 : null), // null values are not plotted by chart, creating gaps
        accuracy: (debugShowAllNotes ? 50 : null),  
        hasValidPitch: (debugShowAllNotes ? true : false), // yes the conditional operator is redundant, it better illustrates the function of debugShowAllNotes
        clarity: clarity
    };
}

// Given detected frequency, find the closest in-tune note; alternate linear search implementation commented
function findClosestNote(frequency) {
    /*
    let closestFreq = sortedFreqs[0];
    for (let i = 1; i < sortedFreqs.length; i++) {
        if (Math.abs(sortedFreqs[i] - frequency) < Math.abs(closestFreq - frequency)) {
            closestFreq = sortedFreqs[i];
        }
    }
    return { targetFreq: closestFreq, noteName: standardFrequencies[closestFreq] };
    */
    
    if (frequency <= sortedFreqs[0]) {
        return { targetFreq: sortedFreqs[0], noteName: standardFrequencies[sortedFreqs[0]] };
    }
    else if (frequency >= sortedFreqs[sortedFreqs.length - 1]) {
        return { targetFreq: sortedFreqs[sortedFreqs.length - 1], noteName: standardFrequencies[sortedFreqs[sortedFreqs.length - 1]] };
    }
    
    let closestFreq = sortedFreqs[0];
    let low = 0;
    let high = sortedFreqs.length - 1;
    
    while (low <= high) {
        let mid = Math.floor((high + low) / 2);
        if (sortedFreqs[mid] <= frequency && ( /* mid === sortedFreqs.length - 1 || */ frequency < sortedFreqs[mid + 1])) {
            if (Math.abs(sortedFreqs[mid] - frequency) < Math.abs(sortedFreqs[mid + 1] - frequency)) {
                closestFreq = sortedFreqs[mid];
            } 
            else {
                closestFreq = sortedFreqs[mid + 1];
            }
            return { targetFreq: closestFreq, noteName: standardFrequencies[closestFreq] };
        }
        if (sortedFreqs[mid] < frequency) {
            low = mid + 1;
        } 
        else if (sortedFreqs[mid] > frequency) {
            high = mid - 1;
        }
    }
    
    console.log('Did not find closest note (this means there is something wrong with the code); frequency: ', frequency);
}


// Live WebSocket recording and playback
recordBtn.onclick = () => {
    isRecording = true;
    recordBtn.disabled = true;
    //playBtn.disabled = true;
    disableDownload();
    audioWSChunks = [];
    accuracyHistory = [];
    historyLog.innerHTML = 'Recording live audio...';
    statusElement.textContent = 'Recording...';

    setTimeout(() => {
        isRecording = false;
        recordBtn.disabled = false;
        statusElement.textContent = 'Recording finished.';
        
        if (audioWSChunks.length > 0) {
            const audioBlob = createWavBlob(audioWSChunks);
            handleRecordedAudio(audioBlob, 'liveWS');
        } else {
            historyLog.innerHTML = 'No audio data received during recording.';
        }
    }, RECORD_DURATION_MS);
};
/*
playBtn.onclick = () => {
    audioPlayer.play();
};
*/
// Called when starting a new recording, deleting the previous recording
function disableDownload() {
    downloadRecordingBtn.disabled = true;
    cleanupLatestRecordingUrl();
    latestRecordingBlob = null;
}

// In-browser microphone recording setup and handling
async function initMicRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        historyLog.innerHTML = 'Microphone recording is not supported in this browser.';
        console.error('Microphone recording not supported');
        return;
    }

    try {
        console.log('Microphone recording supported, attempting to create MediaRecorder');
        //navigator.mediaDevices.getUserMedia({ audio: true }).then((micStream) => {}).catch((err) => {console.error("getUserMedia error:", err);});
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(micStream);

        console.log('MediaRecorder created:', mediaRecorder);

        // When audio data becomes available as a result of calling mediaRecorder.start() (see handleMicRecordClick)
        mediaRecorder.addEventListener('dataavailable', (event) => {
            if (event.data && event.data.size > 0) {
                micChunks.push(event.data);
            }
        });

        // When mediaRecorder.stop() is called
        mediaRecorder.addEventListener('stop', async () => {
            const chunks = micChunks;
            micChunks = [];

            if (chunks.length == 0) {
                disableDownload();
                historyLog.innerHTML = 'No audio captured from microphone. Something has probably gone wrong.';
                //statusElement.textContent = 'Microphone recording stopped.';
                micRecordBtn.textContent = 'Record w/ Mic';
                micRecordBtn.disabled = false;
                return;
            }

            historyLog.innerHTML = 'Processing microphone recording...';
            //statusElement.textContent = 'Processing microphone recording...';
            const audioBlob = new Blob(chunks, { type: 'audio/wav' });
            await processMicRecording(audioBlob);
            micRecordBtn.textContent = 'Record w/ Mic';
            micRecordBtn.disabled = false;
        });

        micRecordBtn.disabled = false;
    } catch (error) {
        console.error('Microphone access denied or failed.', error);
        historyLog.innerHTML = 'Unable to access microphone. Please check browser permissions.';
        micInitPromise = null;
    }
}

async function processMicRecording(blob) {
    historyLog.innerHTML = 'Analyzing microphone recording...';

    try {
        const arrayBuffer = await blob.arrayBuffer();
        const tempAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const pcmData = tempAudioBuffer.getChannelData(0);
        const sampleRate = tempAudioBuffer.sampleRate;

        accuracyHistory = [];
        for (let i = 0; i < pcmData.length - ANALYSIS_BUFFER_SIZE; i += ANALYSIS_BUFFER_SIZE) {
            const chunk = pcmData.slice(i, i + ANALYSIS_BUFFER_SIZE);
            const result = analyzePitch(chunk, sampleRate);
            const time = (i / sampleRate).toFixed(2);
            accuracyHistory.push({ time, ...result });
        }

        //latestRecordingBlob = blob;
        //latestRecordingUrl = URL.createObjectURL(blob);
        //downloadRecordingBtn.disabled = false;
        handleRecordedAudio(blob, 'microphone');
    } catch (error) {
        console.error('Error processing microphone recording:', error);
        historyLog.innerHTML = 'Failed to process microphone recording.';
    }
}

// Microphone record button handler
async function handleMicRecordClick() {
    console.log("Mic record button clicked");
    if (!mediaRecorder) {
        if (!micInitPromise) {
            micInitPromise = initMicRecording();
        }
        await micInitPromise;
    }

    if (!mediaRecorder) {
        console.log("No mediaRecorder available after init");
        return;
    }
    
    // Start recording
    if (mediaRecorder.state === 'inactive') {
        micChunks = [];
        isRecording = true;
        mediaRecorder.start();
        micRecordBtn.textContent = 'Stop Recording';
        //playBtn.disabled = true;
        disableDownload();
        cleanupLatestRecordingUrl();
        historyLog.innerHTML = 'Recording microphone input...';
    } 
    // Stop recording
    else if (mediaRecorder.state === 'recording') {
        micRecordBtn.disabled = true;
        mediaRecorder.stop();
    }
}

// Download button handler
function downloadLatestRecording() {
    if (!latestRecordingBlob) {
        historyLog.innerHTML = 'Nothing to download yet. Record something first.';
        return;
    }

    // Recreate the blob URL if it was cleared by disableDownload()
    if (!latestRecordingUrl) {
        latestRecordingUrl = URL.createObjectURL(latestRecordingBlob);
    }

    if (!downloadAnchor) {
        downloadAnchor = document.createElement('a');
        downloadAnchor.style.display = 'none';
        document.body.appendChild(downloadAnchor);
    }

    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-'); // safe for filenames

    downloadAnchor.href = latestRecordingUrl;
    downloadAnchor.download = `practice-recording-${timestamp}.wav`;
    downloadAnchor.click();

    historyLog.innerHTML = 'Recording ready—download started.';
}

// --- FILE UPLOAD & ANALYSIS ---
fileInput.onchange = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (fileNameDisplay) {
        fileNameDisplay.textContent = `Selected: ${file.name}`;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        historyLog.innerHTML = 'Analyzing file...';
        //console.log(JSON.stringify(sortedFreqs, null, 2));
        
        // audioContext sample rate is 384000, resulting in (384000 / 2048) ~= 187 samples per second regardless of uploaded file's original sample rate 
        audioContext.decodeAudioData(e.target.result, (audioBuffer) => {
            const pcmData = audioBuffer.getChannelData(0);
            const sampleRate = audioBuffer.sampleRate;
            accuracyHistory = [];
            for (let i = 0; i < pcmData.length - ANALYSIS_BUFFER_SIZE; i += ANALYSIS_BUFFER_SIZE) {
                const chunk = pcmData.slice(i, i + ANALYSIS_BUFFER_SIZE);
                const result = analyzePitch(chunk, sampleRate);
                const time = (i / sampleRate).toFixed(2);
                accuracyHistory.push({ time, ...result });
            }

            displayHistory(accuracyHistory, 'file');
            
            const fileUrl = URL.createObjectURL(file);
            audioPlayer.src = fileUrl;
            //playBtn.disabled = false;
        });
    };
    reader.readAsArrayBuffer(file);

    // Allow re-selection of the same file
    event.target.value = null;
};


// --- PLAYHEAD PLUGIN ---
const playheadPlugin = {
    id: 'playhead',
    afterDatasetsDraw(chart) {
        if (!audioPlayer.src || !audioPlayer.duration) return;
        
        const { ctx, chartArea: { left, right, top, bottom }, scales: { x } } = chart;
        const currentTime = audioPlayer.currentTime;
        
        // Auto-scroll the chart if the playhead goes beyond the current x-axis range
        const xMin = x.min;
        const xMax = x.max;
        const visibleRange = xMax - xMin;
        
        if (currentTime >= xMax && currentTime <= audioPlayer.duration) {
            const newMin = xMax;
            const newMax = newMin + visibleRange;
            
            if (newMax < audioPlayer.duration) {
                chart.options.scales.x.min = newMin;
                chart.options.scales.x.max = newMax;
            }
            else { // Scroll to end without going beyond
                chart.options.scales.x.min = audioPlayer.duration - visibleRange;
                chart.options.scales.x.max = audioPlayer.duration;
            }
        }
        
        // Draw the playhead
        const xPos = x.getPixelForValue(currentTime.toFixed(2));
        
        if (xPos >= left && xPos <= right) {
            ctx.save();
            
            ctx.strokeStyle = 'rgba(255, 99, 71, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(xPos, top);
            ctx.lineTo(xPos, bottom);
            ctx.stroke();
            
            ctx.fillStyle = 'rgba(255, 99, 71, 0.8)';
            ctx.beginPath();
            ctx.moveTo(xPos, top);
            ctx.lineTo(xPos - 6, top - 10);
            ctx.lineTo(xPos + 6, top - 10);
            ctx.closePath();
            ctx.fill();
            
            ctx.restore();
        }
    }
};

// --- AUDIO PLAYBACK CONTROLS ---
function updatePlayheadPosition() {
    if (accuracyChart && !audioPlayer.paused) {
        accuracyChart.update('none');
        playheadAnimationId = requestAnimationFrame(updatePlayheadPosition);
    }
}

playPauseBtn.onclick = () => {
    if (audioPlayer.paused) {
        audioPlayer.play();
    } else {
        audioPlayer.pause();
    }
};

audioPlayer.onplay = () => {
    playPauseBtn.textContent = '⏸';
    updatePlayheadPosition();
};

audioPlayer.onpause = () => {
    playPauseBtn.textContent = '▶';
    if (playheadAnimationId) {
        cancelAnimationFrame(playheadAnimationId);
        playheadAnimationId = null;
    }
    if (accuracyChart) {
        accuracyChart.update('none');
    }
};

audioPlayer.onended = () => {
    playPauseBtn.textContent = '▶';
    if (playheadAnimationId) {
        cancelAnimationFrame(playheadAnimationId);
        playheadAnimationId = null;
    }
    if (accuracyChart) {
        accuracyChart.update('none');
    }
};

audioPlayer.onloadedmetadata = () => {
    playPauseBtn.disabled = false;
};

// --- OPTIONS ---
if (useCentsToggle) {
    useCentsToggle.addEventListener('change', () => {
        applyChartMetric(useCentsToggle.value);
        console.log('Selected metric:', useCentsToggle.value);
    });
}

function applyChartMetric(metric) {
    if (!accuracyChart) {
        return;
    }

    const dataPoints = accuracyHistory.map(item => ({
        x: parseFloat(item.time),
        y: item.accuracy !== null
            ? (metric == 'cents' ? parseFloat(item.cents) : parseFloat(item.accuracy))
            : null
    }));

    accuracyChart.data.datasets[0].data = dataPoints;

    if (metric == 'cents') {
        accuracyChart.data.datasets[0].label = 'Note Accuracy (Cents)';
        accuracyChart.options.scales.y.title.text = 'Cents';
        accuracyChart.options.scales.y.min = -50;
        accuracyChart.options.scales.y.max = 50;
        accuracyChart.options.scales.y.beginAtZero = false;
    } else {
        accuracyChart.data.datasets[0].label = 'Note Accuracy (%)';
        accuracyChart.options.scales.y.title.text = 'Accuracy (%)';
        accuracyChart.options.scales.y.min = 0;
        accuracyChart.options.scales.y.max = 100;
        accuracyChart.options.scales.y.beginAtZero = true;
    }

    accuracyChart.update();
}

submitPitchBtn.onclick = () => {
    const inputFreq = parseFloat(standardPitchInput.value);
    if (isNaN(inputFreq)) {
        alert('Please enter a valid frequency');
        return;
    }
    A4 = inputFreq;
    generateStandardFrequencies();
    console.log('Standard pitch frequency set to:', inputFreq);
}

// --- LOW CLARITY BACKGROUND PLUGIN ---
const lowClarityBackgroundPlugin = {
    id: 'lowClarityBackground',
    beforeDatasetsDraw(chart) {
        const { ctx, chartArea: { left, right, top, bottom }, scales: { x, y } } = chart;
        const history = chart.config.options.historyData;
        
        if (!history) return;
        
        ctx.save();
        ctx.fillStyle = 'rgba(106, 104, 253, 0.2)';
        
        // Draw background for low clarity sections
        // Draws transparent rect for every low clarity point, instead of more intelligently finding stretches of mostly low clarity points - best way to do this?
        for (let i = 0; i < history.length; i++) {
            if (!history[i].hasValidPitch) {
                const xStart = x.getPixelForValue(parseFloat(history[i].time));
                const xEnd = i < history.length - 1 ? 
                    x.getPixelForValue(parseFloat(history[i + 1].time)) : right; 
                
                if (xStart >= left && xStart <= right) {
                    ctx.fillRect(xStart, top, xEnd - xStart, bottom - top);
                }
            }
        }
        
        ctx.restore();
    }
};

// --- UI & UTILITY FUNCTIONS ---
function renderAccuracyChart(history) {
    if (!history || history.length === 0) {
        if (accuracyChart) {
            accuracyChart.destroy();
            accuracyChart = null;
        }
        return;
    }

    const ctx = accuracyChartCanvas.getContext('2d');
    
    // Destroy existing chart if it exists
    if (accuracyChart) {
        accuracyChart.destroy();
    }

    const selectedMetric = useCentsToggle ? useCentsToggle.value : 'accuracy';
    const dataPoints = history.map(item => ({
        x: parseFloat(item.time),
        y: (item.hasValidPitch == true)
            ? parseFloat(selectedMetric == 'cents' ? item.cents : item.accuracy)
            : null
        //y: (item.accuracy !== null || debugShowAllNotes) ? parseFloat(item.accuracy) : null
    }));
    const datasetLabel = selectedMetric == 'cents' ? 'Note Accuracy (Cents)' : 'Note Accuracy (%)';
    const yAxisMin = selectedMetric == 'cents' ? -50 : 0;
    const yAxisMax = selectedMetric == 'cents' ? 50 : 100;
    const beginAtZero = selectedMetric != 'cents';

    accuracyChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: datasetLabel,
                data: dataPoints,
                borderColor: '#4299e1',
                backgroundColor: '#4299e1',
                borderWidth: 0,
                fill: false,
                showLine: false,
                tension: 0,
                pointBackgroundColor: '#4299e1',
                pointBorderColor: '#2b6cb0',
                pointRadius: 3,
                pointHoverRadius: 5,
                spanGaps: false  // Don't connect lines across null values
            }]
        },
        plugins: [lowClarityBackgroundPlugin, playheadPlugin],
        options: {
            parsing: false,
            normalized: true,
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            historyData: history,  // Store history for plugins to access
            onClick: (event) => {
                const canvasPosition = Chart.helpers.getRelativePosition(event, accuracyChart);
                const dataX = accuracyChart.scales.x.getValueForPixel(canvasPosition.x);
                audioPlayer.currentTime = dataX;
            },
            scales: {
                y: {
                    beginAtZero,
                    min: yAxisMin,
                    max: yAxisMax,
                    title: {
                        display: true,
                        text: selectedMetric === 'cents' ? 'Cents' : 'Accuracy (%)'
                    },
                    grid: {
                        color: 'rgba(0,0,0,0.1)'
                    }
                },
                x: {
                    type: 'linear',  // Use linear scale for even time spacing
                    title: {
                        display: true,
                        text: 'Time (seconds)'
                    },
                    grid: {
                        color: 'rgba(0,0,0,0.1)'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: function(context) {
                            const dataIndex = context[0].dataIndex;
                            const item = history[dataIndex];
                            return `Time: ${item.time}s`;
                        },
                        label: function(context) {
                            const dataIndex = context.dataIndex;
                            const item = history[dataIndex];
                            
                            if (!item.hasValidPitch) {
                                return 'Low Clarity - No pitch detected';
                            }
                            
                            return [
                                `Accuracy: ${item.accuracy}%`,
                                `Note: ${item.noteName}`,
                                `Frequency: ${item.pitch}Hz`,
                                `Cents: ${item.cents}`
                            ];
                        }
                    }
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        animation: {
                            duration: 0
                        }
                    },
                    limits: {
                        x: {min: 0, max: history[history.length - 1].time}
                        //alternate min: history[0].time, try casting as int to prevent rendering as 0.000000...
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'x',
                        animation: {
                            duration: 0
                        }
                    }
                },
                /*
                decimation: {
                    enabled: true,
                    algorithm: 'lttb',
                    samples: 500,
                    threshold: 1000
                }
                */
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });

    //applyChartMetric(selectedMetric);
}

function displayHistory(history, type) {
    if (history.length > 0) {
        //historyLog.innerHTML = history.map(item => 
        //    `Time: ${item.time}s | Freq: ${item.pitch}Hz | Note: ${item.noteName} | Cents: ${item.cents} | Accuracy: ${item.accuracy}%`
        //).join('<br>');
        
        // Render the accuracy chart
        renderAccuracyChart(history);
        //uploadedFileName = (type === 'file') ? fileInput.files[0].name : null;
        historyLog.innerHTML = `Displaying ${history.length} analyzed notes from the ${type === 'live' ? 'live recording' : 'uploaded file'}.`;

    } else {
        historyLog.innerHTML = `No clear notes were detected in the ${type === 'live' ? 'recording' : 'file'}.`;
        
        // Clear the chart if no data
        renderAccuracyChart([]);
    }
}

function createWavBlob(audioWSChunks) {
    let totalLength = 0;
    audioWSChunks.forEach(chunk => { totalLength += chunk.length; });
    const pcmData = new Int16Array(totalLength);
    let offset = 0;
    audioWSChunks.forEach(chunk => { pcmData.set(chunk, offset); offset += chunk.length; });
    const buffer = new ArrayBuffer(44 + pcmData.byteLength);
    const view = new DataView(buffer);
    const numChannels = 1, bitsPerSample = 16;
    const blockAlign = numChannels * bitsPerSample / 8;
    const byteRate = LIVE_SAMPLE_RATE * blockAlign;
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.byteLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, LIVE_SAMPLE_RATE, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, pcmData.byteLength, true);
    new Int16Array(buffer, 44).set(pcmData);
    return new Blob([view], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}
