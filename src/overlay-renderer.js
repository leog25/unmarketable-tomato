const { ipcRenderer } = require('electron');

const captionElement = document.getElementById('caption');
let hideTimeout = null;

ipcRenderer.on('caption-update', (event, data) => {
    const { text, isFinal } = data;
    
    if (text && text.trim()) {
        captionElement.textContent = text;
        captionElement.className = `caption-text show ${isFinal ? '' : 'interim'}`;
        
        clearTimeout(hideTimeout);
        
        if (isFinal) {
            hideTimeout = setTimeout(() => {
                captionElement.classList.remove('show');
            }, 3000);
        }
    } else {
        captionElement.classList.remove('show');
    }
});