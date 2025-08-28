const { ipcRenderer } = require('electron');

const captionElement = document.getElementById('caption');
let hideTimeout = null;

// Function to convert hex to rgba
function hexToRgba(hex, opacity) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
        const r = parseInt(result[1], 16);
        const g = parseInt(result[2], 16);
        const b = parseInt(result[3], 16);
        return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
    }
    return hex;
}

// Handle caption style updates
ipcRenderer.on('caption-styles', (event, styles) => {
    const { bgColor, textColor, fontSize, fontFamily, opacity } = styles;
    
    // Apply styles to caption element
    captionElement.style.backgroundColor = hexToRgba(bgColor, opacity);
    captionElement.style.color = textColor;
    captionElement.style.fontSize = fontSize + 'px';
    captionElement.style.fontFamily = fontFamily;
    
    // Also update interim style
    const styleSheet = document.createElement('style');
    styleSheet.textContent = `
        .caption-text.interim {
            background: ${hexToRgba(bgColor, Math.max(50, opacity - 20))} !important;
        }
    `;
    document.head.appendChild(styleSheet);
});

ipcRenderer.on('caption-update', (event, data) => {
    const { text, isFinal } = data;
    
    if (text && text.trim()) {
        captionElement.textContent = text;
        captionElement.className = `caption-text show ${isFinal ? '' : 'interim'}`;
        
        clearTimeout(hideTimeout);
        
        if (isFinal) {
            hideTimeout = setTimeout(() => {
                captionElement.classList.remove('show');
            }, 5000);
        }
    } else {
        captionElement.classList.remove('show');
    }
});