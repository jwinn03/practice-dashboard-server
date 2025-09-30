// Import the PitchDetector class from the pitchy ES Module
import { PitchDetector } from 'https://esm.sh/pitchy@4.1.0';

// DOM Elements
const statusElement = document.getElementById('status');
const recordBtn = document.getElementById('recordBtn');
const playBtn = document.getElementById('playBtn');
const audioPlayer = document.getElementById('audioPlayer');
const noteEl = document.getElementById('note');
const frequencyEl = document.getElementById('frequency');
const centsEl = document.getElementById('cents');
const accuracyEl = document.getElementById('accuracy');
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
        }
        const analysisResult = analyzePitch(pcmData, LIVE_SAMPLE_RATE);
        if (isRecording && analysisResult) {
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
    if (!pitchyDetector) return null;

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

        noteEl.textContent = noteName;
        frequencyEl.textContent = pitch.toFixed(1);
        centsEl.textContent = cents.toFixed(1);
        accuracyEl.textContent = `${accuracy.toFixed(0)}%`;

        return { pitch: pitch.toFixed(1), noteName, cents: cents.toFixed(1), accuracy: accuracy.toFixed(0) };
    }
    return null;
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
                if(result) {
                    const time = (i / sampleRate).toFixed(2);
                    fileAccuracyHistory.push({ time, ...result });
                }
                console.log(i);
                
            }
            console.log("pcmdata length: " + pcmData.length);
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

    const labels = history.map(item => item.time);
    const accuracyData = history.map(item => parseFloat(item.accuracy));

    accuracyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Note Accuracy (%)',
                data: accuracyData,
                borderColor: '#4299e1',
                backgroundColor: 'rgba(66, 153, 225, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#4299e1',
                pointBorderColor: '#2b6cb0',
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (event) => {
                const activePoints = accuracyChart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, false);
                if (activePoints.length > 0) {
                    const clickedIndex = activePoints[0].index;
                    const time = accuracyChart.data.labels[clickedIndex];
                    audioPlayer.currentTime = parseFloat(time);
                }
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
                            return `Time: ${context[0].label}s`;
                        },
                        label: function(context) {
                            const dataIndex = context.dataIndex;
                            const item = history[dataIndex];
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
        historyLog.innerHTML = history.map(item => 
            `Time: ${item.time}s | Freq: ${item.pitch}Hz | Note: ${item.noteName} | Cents: ${item.cents} | Accuracy: ${item.accuracy}%`
        ).join('<br>');
        
        // Render the accuracy chart
        renderAccuracyChart(history);
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
