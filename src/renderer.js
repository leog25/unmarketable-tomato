const { ipcRenderer } = require('electron');
const SpeechRecognition = require('./speech-recognition');

let speechRecognition = null;
let isListening = false;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const languageSelect = document.getElementById('language');
const micSelect = document.getElementById('micSelect');

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

// Load available microphones
async function loadMicrophones() {
    try {
        // Request permissions first
        await navigator.mediaDevices.getUserMedia({ audio: true });
        
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
    } catch (error) {
        console.error('Failed to enumerate devices:', error);
        updateStatus('Failed to load microphones', 'error');
    }
}

// Load microphones on startup
loadMicrophones();

// Reload microphones when devices change
navigator.mediaDevices.addEventListener('devicechange', loadMicrophones);

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
});