const { ipcRenderer } = require('electron');
const SpeechRecognition = require('./speech-recognition');

let speechRecognition = null;
let isListening = false;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const languageSelect = document.getElementById('language');
const micSelect = document.getElementById('micSelect');
const micMeter = document.getElementById('micMeter');

let audioContext = null;
let analyser = null;
let microphone = null;
let animationId = null;
let audioStream = null;

function updateStatus(message, type = 'ready') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
}

function updateUI(listening) {
    isListening = listening;
    startBtn.style.display = listening ? 'none' : 'block';
    stopBtn.style.display = listening ? 'block' : 'none';
    languageSelect.disabled = listening;
    micSelect.disabled = listening;
}

// Initialize audio context and analyser for mic meter
async function initAudioMeter(deviceId) {
    try {
        const constraints = {
            audio: deviceId ? { deviceId: { exact: deviceId } } : true
        };
        
        audioStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(audioStream);
        
        analyser.smoothingTimeConstant = 0.8;
        analyser.fftSize = 1024;
        
        microphone.connect(analyser);
        
        updateMicMeter();
    } catch (error) {
        console.error('Failed to initialize audio meter:', error);
    }
}

// Update mic meter visualization
function updateMicMeter() {
    if (!analyser) return;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
    }
    const average = sum / bufferLength;
    
    // Convert to percentage (0-100)
    const percentage = Math.min(100, (average / 255) * 150);
    
    // Update meter width
    micMeter.style.width = percentage + '%';
    
    // Continue animation
    animationId = requestAnimationFrame(updateMicMeter);
}

// Stop audio meter
function stopAudioMeter() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    
    if (microphone) {
        microphone.disconnect();
        microphone = null;
    }
    
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    
    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
        audioContext = null;
    }
    
    analyser = null;
    micMeter.style.width = '0%';
}

// Load available microphones
async function loadMicrophones() {
    try {
        // Request permissions first
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const microphones = devices.filter(device => device.kind === 'audioinput');
        
        // Clear existing options except default
        micSelect.innerHTML = '<option value="">Default Microphone</option>';
        
        microphones.forEach(mic => {
            const option = document.createElement('option');
            option.value = mic.deviceId;
            option.textContent = mic.label || `Microphone ${mic.deviceId.substr(0, 8)}`;
            micSelect.appendChild(option);
        });
        
        console.log(`Found ${microphones.length} microphones`);
        
        // Initialize meter with default device
        await initAudioMeter();
    } catch (error) {
        console.error('Failed to enumerate devices:', error);
        updateStatus('Failed to load microphones', 'error');
    }
}

// Load microphones on startup
loadMicrophones();

// Reload microphones when devices change
navigator.mediaDevices.addEventListener('devicechange', async () => {
    stopAudioMeter();
    await loadMicrophones();
});

// Handle microphone selection change
micSelect.addEventListener('change', async () => {
    stopAudioMeter();
    await initAudioMeter(micSelect.value);
});

startBtn.addEventListener('click', async () => {
    try {
        updateStatus('Initializing...', 'listening');
        
        const language = languageSelect.value;
        const deviceId = micSelect.value || undefined;
        speechRecognition = new SpeechRecognition(language, deviceId);
        
        speechRecognition.on('start', () => {
            updateStatus('Listening for speech...', 'listening');
            updateUI(true);
            ipcRenderer.send('show-overlay');
        });
        
        speechRecognition.on('interim', (text) => {
            ipcRenderer.send('update-caption', { text, isFinal: false });
        });
        
        speechRecognition.on('final', (text) => {
            ipcRenderer.send('update-caption', { text, isFinal: true });
        });
        
        speechRecognition.on('error', (error) => {
            updateStatus(`Error: ${error.message}`, 'error');
            updateUI(false);
            ipcRenderer.send('hide-overlay');
        });
        
        speechRecognition.on('stop', () => {
            updateStatus('Stopped', 'ready');
            updateUI(false);
            ipcRenderer.send('hide-overlay');
        });
        
        await speechRecognition.start();
        
    } catch (error) {
        updateStatus(`Failed to start: ${error.message}`, 'error');
        updateUI(false);
    }
});

stopBtn.addEventListener('click', () => {
    if (speechRecognition) {
        speechRecognition.stop();
    }
});

window.addEventListener('beforeunload', () => {
    if (speechRecognition) {
        speechRecognition.stop();
    }
    stopAudioMeter();
});