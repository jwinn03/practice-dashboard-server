// Import the PitchDetector class from the pitchy ES Module
import { PitchDetector } from 'https://esm.sh/pitchy@4.1.0';

// DOM Elements
const statusElement = document.getElementById('status');
const recordBtn = document.getElementById('recordBtn');
const playBtn = document.getElementById('playBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const audioPlayer = document.getElementById('audioPlayer');
//const noteEl = document.getElementById('note');
//const frequencyEl = document.getElementById('frequency');
//const centsEl = document.getElementById('cents');
//const accuracyEl = document.getElementById('accuracy');
const historyLog = document.getElementById('historyLog');
const fileInput = document.getElementById('fileInput');
const accuracyChartCanvas = document.getElementById('accuracyChart');

// Audio & Recording Constants
const LIVE_SAMPLE_RATE = 16000;
const RECORD_DURATION_MS = 5000;
const ANALYSIS_BUFFER_SIZE = 2048;

// State Variables
let isRecording = false;
let audioChunks = [];
let accuracyHistory = [];
let pitchyDetector;
let audioContext;
let accuracyChart;
let playheadAnimationId = null;

// --- NOTE & FREQUENCY DATA ---
const A4 = 440;
const noteNames = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
const standardFrequencies = {};
for (let i = 0; i < 88; i++) {
    const freq = A4 * Math.pow(2, (i - 48) / 12);
    const octave = Math.floor((i + 9) / 12); //change - remove -1
    const noteName = noteNames[i % 12];
    standardFrequencies[freq] = `${noteName}${octave}`;
}
const sortedFreqs = Object.keys(standardFrequencies).map(Number).sort((a, b) => a - b);


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
            audioChunks.push(pcmData);
            const analysisResult = analyzePitch(pcmData, LIVE_SAMPLE_RATE);
            const time = (audioChunks.length * pcmData.length / LIVE_SAMPLE_RATE).toFixed(2);
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

        //noteEl.textContent = noteName;
        //frequencyEl.textContent = pitch.toFixed(1);
        //centsEl.textContent = cents.toFixed(1);
        //accuracyEl.textContent = `${accuracy.toFixed(0)}%`;

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
        cents: 0, 
        accuracy: null,  // null creates a gap in the chart line
        hasValidPitch: false,
        clarity: clarity
    };
}

function findClosestNote(frequency) {
    let closestFreq = sortedFreqs[0];
    for (let i = 1; i < sortedFreqs.length; i++) {
        if (Math.abs(sortedFreqs[i] - frequency) < Math.abs(closestFreq - frequency)) {
            closestFreq = sortedFreqs[i];
        }
    }
    return { targetFreq: closestFreq, noteName: standardFrequencies[closestFreq] };
}


// --- LIVE RECORDING & PLAYBACK ---
recordBtn.onclick = () => {
    isRecording = true;
    recordBtn.disabled = true;
    playBtn.disabled = true;
    audioChunks = [];
    accuracyHistory = [];
    historyLog.innerHTML = 'Recording live audio...';
    statusElement.textContent = 'Recording...';

    setTimeout(() => {
        isRecording = false;
        recordBtn.disabled = false;
        statusElement.textContent = 'Recording finished.';
        
        displayHistory(accuracyHistory, 'live');

        if (audioChunks.length > 0) {
            const audioBlob = createWavBlob(audioChunks);
            const audioUrl = URL.createObjectURL(audioBlob);
            audioPlayer.src = audioUrl;
            playBtn.disabled = false;
        } else {
            historyLog.innerHTML = 'No audio data received during recording.';
        }
    }, RECORD_DURATION_MS);
};

playBtn.onclick = () => {
    audioPlayer.play();
};

// --- FILE UPLOAD & ANALYSIS ---
fileInput.onchange = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        //historyLog.innerHTML = 'Analyzing file...';
        //historyLog.innerHTML = JSON.stringify(standardFrequencies, null, 2);

        
        audioContext.decodeAudioData(e.target.result, (audioBuffer) => {
            const pcmData = audioBuffer.getChannelData(0);
            const sampleRate = audioBuffer.sampleRate;
            const fileAccuracyHistory = [];

            for (let i = 0; i < pcmData.length - ANALYSIS_BUFFER_SIZE; i += ANALYSIS_BUFFER_SIZE) {
                const chunk = pcmData.slice(i, i + ANALYSIS_BUFFER_SIZE);
                const result = analyzePitch(chunk, sampleRate);
                const time = (i / sampleRate).toFixed(2);
                fileAccuracyHistory.push({ time, ...result });
            }
            
            displayHistory(fileAccuracyHistory, 'file');
            
            const fileUrl = URL.createObjectURL(file);
            audioPlayer.src = fileUrl;
            playBtn.disabled = false;
        });
    };
    reader.readAsArrayBuffer(file);

    
};

//TODO:
//Add abilility to switch between cents and % accuracy in UI
//Add audio player to fit with the chart

// --- PLAYHEAD PLUGIN ---
const playheadPlugin = {
    id: 'playhead',
    afterDatasetsDraw(chart) {
        if (!audioPlayer.src || !audioPlayer.duration) return;
        
        const { ctx, chartArea: { left, right, top, bottom }, scales: { x } } = chart;
        const currentTime = audioPlayer.currentTime;
        
        // Find the x position based on current time
        const xPos = x.getPixelForValue(currentTime.toFixed(2));
        
        // Only draw if the playhead is within the visible chart area
        if (xPos >= left && xPos <= right) {
            ctx.save();
            
            // Draw vertical line
            ctx.strokeStyle = 'rgba(255, 99, 71, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(xPos, top);
            ctx.lineTo(xPos, bottom);
            ctx.stroke();
            
            // Draw triangle indicator at top
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
    console.log(history[0].time);
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

    // Create data points with x,y coordinates for linear scale
    const dataPoints = history.map(item => ({
        x: parseFloat(item.time),
        y: item.accuracy !== null ? parseFloat(item.accuracy) : null
    }));

    accuracyChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Note Accuracy (%)',
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
                    beginAtZero: true,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Accuracy (%)'
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
                        mode: 'x'
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
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

function displayHistory(history, type) {
    if (history.length > 0) {
        //historyLog.innerHTML = history.map(item => 
        //    `Time: ${item.time}s | Freq: ${item.pitch}Hz | Note: ${item.noteName} | Cents: ${item.cents} | Accuracy: ${item.accuracy}%`
        //).join('<br>');
        historyLog.innerHTML = 'Analyzing...';
        // Render the accuracy chart
        renderAccuracyChart(history);
        historyLog.innerHTML = `Displaying ${history.length} analyzed notes from the ${type === 'live' ? 'live recording' : 'uploaded file'}.`;
    } else {
        historyLog.innerHTML = `No clear notes were detected in the ${type === 'live' ? 'recording' : 'file'}.`;
        
        // Clear the chart if no data
        renderAccuracyChart([]);
    }
}

function createWavBlob(audioChunks) {
    let totalLength = 0;
    audioChunks.forEach(chunk => { totalLength += chunk.length; });
    const pcmData = new Int16Array(totalLength);
    let offset = 0;
    audioChunks.forEach(chunk => { pcmData.set(chunk, offset); offset += chunk.length; });
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
