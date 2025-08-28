const { ipcRenderer } = require('electron');
const SpeechRecognition = require('./speech-recognition');

let speechRecognition = null;
let isListening = false;

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const testBtn = document.getElementById('testBtn');
const statusDiv = document.getElementById('status');
const languageSelect = document.getElementById('language');
const micSelect = document.getElementById('micSelect');
const micMeter = document.getElementById('micMeter');

// Caption customization elements
const captionBgColor = document.getElementById('captionBgColor');
const captionTextColor = document.getElementById('captionTextColor');
const captionFontSize = document.getElementById('captionFontSize');
const fontSizeValue = document.getElementById('fontSizeValue');
const captionFontFamily = document.getElementById('captionFontFamily');
const captionOpacity = document.getElementById('captionOpacity');
const opacityValue = document.getElementById('opacityValue');
const glassmorphicToggle = document.getElementById('glassmorphicToggle');

let audioContext = null;
let analyser = null;
let microphone = null;
let animationId = null;
let audioStream = null;
let deviceChangeDebounceTimer = null;
let deviceChangeHandler = null;

function updateStatus(message, type = 'ready') {
    // Simplify status messages for minimalist design
    const simpleMessages = {
        'Initializing...': 'Starting...',
        'Listening for speech...': 'Listening',
        'Stopped': 'Ready',
        'Ready to start': 'Ready',
        'Failed to access microphones': 'Microphone Error'
    };
    
    const displayMessage = simpleMessages[message] || message;
    statusDiv.textContent = displayMessage;
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
        // Stop existing meter first
        stopAudioMeter();
        
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
        
        // Only start meter animation if not currently listening
        if (!isListening) {
            updateMicMeter();
        }
    } catch (error) {
        // Audio meter is optional, fail silently
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
        
        
        // Initialize meter with default device
        await initAudioMeter();
    } catch (error) {
        updateStatus('Failed to access microphones', 'error');
    }
}

// Load microphones on startup
loadMicrophones();

// Load saved caption settings or set defaults
function loadCaptionSettings() {
    const settings = {
        bgColor: localStorage.getItem('captionBgColor') || '#ff6347',
        textColor: localStorage.getItem('captionTextColor') || '#ffffff',
        fontSize: localStorage.getItem('captionFontSize') || '28',
        fontFamily: localStorage.getItem('captionFontFamily') || 'Arial, sans-serif',
        opacity: localStorage.getItem('captionOpacity') || '85',
        glassmorphic: localStorage.getItem('captionGlassmorphic') !== 'false' // Default to true
    };
    
    captionBgColor.value = settings.bgColor;
    captionTextColor.value = settings.textColor;
    captionFontSize.value = settings.fontSize;
    fontSizeValue.textContent = settings.fontSize + 'px';
    captionFontFamily.value = settings.fontFamily;
    captionOpacity.value = settings.opacity;
    opacityValue.textContent = settings.opacity + '%';
    glassmorphicToggle.checked = settings.glassmorphic;
    
    // Update opacity label based on glassmorphic state
    updateOpacityLabel(settings.glassmorphic);
    
    return settings;
}

// Save caption settings
function saveCaptionSettings() {
    localStorage.setItem('captionBgColor', captionBgColor.value);
    localStorage.setItem('captionTextColor', captionTextColor.value);
    localStorage.setItem('captionFontSize', captionFontSize.value);
    localStorage.setItem('captionFontFamily', captionFontFamily.value);
    localStorage.setItem('captionOpacity', captionOpacity.value);
    localStorage.setItem('captionGlassmorphic', glassmorphicToggle.checked);
}

// Get current caption settings
function getCaptionSettings() {
    return {
        bgColor: captionBgColor.value,
        textColor: captionTextColor.value,
        fontSize: captionFontSize.value,
        fontFamily: captionFontFamily.value,
        opacity: captionOpacity.value,
        glassmorphic: glassmorphicToggle.checked
    };
}

// Update opacity label based on glassmorphic state
function updateOpacityLabel(isGlassmorphic) {
    const label = document.querySelector('label[for="captionOpacity"]');
    if (label) {
        label.textContent = isGlassmorphic ? 'Glass Effect Intensity' : 'Background Opacity';
    }
}

// Initialize caption settings
const initialSettings = loadCaptionSettings();

// Update caption styles in overlay
function updateCaptionStyles() {
    saveCaptionSettings();
    ipcRenderer.send('update-caption-styles', getCaptionSettings());
}

// Caption style presets (opacity is higher for glassmorphic effect)
const captionPresets = {
    tomato: {
        bgColor: '#ff6347',
        textColor: '#ffffff',
        fontSize: '28',
        fontFamily: 'Arial, sans-serif',
        opacity: '85'
    },
    black: {
        bgColor: '#000000',
        textColor: '#ffffff',
        fontSize: '24',
        fontFamily: "'Segoe UI', Tahoma, sans-serif",
        opacity: '75'
    },
    white: {
        bgColor: '#ffffff',
        textColor: '#000000',
        fontSize: '24',
        fontFamily: "'Segoe UI', Tahoma, sans-serif",
        opacity: '80'
    }
};

// Apply a preset
function applyPreset(presetName) {
    const preset = captionPresets[presetName];
    if (preset) {
        captionBgColor.value = preset.bgColor;
        captionTextColor.value = preset.textColor;
        captionFontSize.value = preset.fontSize;
        fontSizeValue.textContent = preset.fontSize + 'px';
        captionFontFamily.value = preset.fontFamily;
        captionOpacity.value = preset.opacity;
        opacityValue.textContent = preset.opacity + '%';
        
        updateCaptionStyles();
    }
}

// Add event listeners for preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const preset = btn.dataset.preset;
        applyPreset(preset);
    });
});

// Add event listeners for caption customization
captionBgColor.addEventListener('change', updateCaptionStyles);
captionTextColor.addEventListener('change', updateCaptionStyles);
captionFontSize.addEventListener('input', () => {
    fontSizeValue.textContent = captionFontSize.value + 'px';
    updateCaptionStyles();
});
captionFontFamily.addEventListener('change', updateCaptionStyles);
captionOpacity.addEventListener('input', () => {
    opacityValue.textContent = captionOpacity.value + '%';
    updateCaptionStyles();
});
glassmorphicToggle.addEventListener('change', () => {
    updateOpacityLabel(glassmorphicToggle.checked);
    updateCaptionStyles();
});

// Debounced device change handler
deviceChangeHandler = async () => {
    // Clear any existing timer
    if (deviceChangeDebounceTimer) {
        clearTimeout(deviceChangeDebounceTimer);
    }
    
    // Debounce - wait 500ms after last change
    deviceChangeDebounceTimer = setTimeout(async () => {
        if (!isListening) {
            stopAudioMeter();
            await loadMicrophones();
        }
    }, 500);
};

// Reload microphones when devices change
navigator.mediaDevices.addEventListener('devicechange', deviceChangeHandler);

// Handle microphone selection change
micSelect.addEventListener('change', async () => {
    if (!isListening) {
        stopAudioMeter();
        await initAudioMeter(micSelect.value);
    }
});

startBtn.addEventListener('click', async () => {
    try {
        updateStatus('Initializing...', 'listening');
        
        // Stop audio meter when starting recording
        stopAudioMeter();
        
        const language = languageSelect.value;
        const deviceId = micSelect.value || undefined;
        speechRecognition = new SpeechRecognition(language, deviceId);
        
        speechRecognition.on('start', () => {
            updateStatus('Listening for speech...', 'listening');
            updateUI(true);
            ipcRenderer.send('show-overlay');
            ipcRenderer.send('update-caption-styles', getCaptionSettings());
        });
        
        speechRecognition.on('interim', (text) => {
            if (text && text.trim()) {
                ipcRenderer.send('update-caption', { text, isFinal: false });
            }
        });
        
        speechRecognition.on('final', (text) => {
            if (text && text.trim()) {
                ipcRenderer.send('update-caption', { text, isFinal: true });
            }
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
            // Restart audio meter after stopping
            initAudioMeter(micSelect.value);
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
        speechRecognition = null;
    }
});

// Test button to verify overlay display
testBtn.addEventListener('click', () => {
    ipcRenderer.send('show-overlay');
    ipcRenderer.send('update-caption-styles', getCaptionSettings());
    
    // Send test captions
    setTimeout(() => {
        ipcRenderer.send('update-caption', { text: 'Testing captions: Hello World!', isFinal: false });
    }, 500);
    
    setTimeout(() => {
        ipcRenderer.send('update-caption', { text: 'This is a test caption display.', isFinal: true });
    }, 2000);
    
    setTimeout(() => {
        ipcRenderer.send('hide-overlay');
    }, 7000);
});

// Cleanup function
function cleanup() {
    // Remove event listeners
    if (deviceChangeHandler) {
        navigator.mediaDevices.removeEventListener('devicechange', deviceChangeHandler);
    }
    
    // Clear timers
    if (deviceChangeDebounceTimer) {
        clearTimeout(deviceChangeDebounceTimer);
    }
    
    
    // Stop speech recognition
    if (speechRecognition) {
        speechRecognition.stop();
        speechRecognition = null;
    }
    
    // Stop audio meter
    stopAudioMeter();
}

window.addEventListener('beforeunload', cleanup);