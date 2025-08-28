const { ipcRenderer } = require('electron');

const captionElement = document.getElementById('caption');
let hideTimeout = null;

ipcRenderer.on('caption-update', (event, data) => {
    console.log('Caption update received in overlay:', data);
    const { text, isFinal } = data;
    
    if (text && text.trim()) {
        captionElement.textContent = text;
        captionElement.className = `caption-text show ${isFinal ? '' : 'interim'}`;
        console.log('Caption element updated with text:', text);
        console.log('Caption element classes:', captionElement.className);
        
        clearTimeout(hideTimeout);
        
        if (isFinal) {
            hideTimeout = setTimeout(() => {
                captionElement.classList.remove('show');
                console.log('Caption hidden after timeout');
            }, 5000);
        }
    } else {
        captionElement.classList.remove('show');
        console.log('Caption cleared - empty text');
    }
});