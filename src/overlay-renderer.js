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
    
    // Apply glassmorphic styles to caption element
    const bgOpacity = opacity / 100 * 0.3; // Lower opacity for glass effect
    captionElement.style.background = hexToRgba(bgColor, bgOpacity * 100);
    captionElement.style.backdropFilter = 'blur(20px) saturate(180%)';
    captionElement.style.webkitBackdropFilter = 'blur(20px) saturate(180%)';
    captionElement.style.color = textColor;
    captionElement.style.fontSize = fontSize + 'px';
    captionElement.style.fontFamily = fontFamily;
    captionElement.style.border = '1px solid rgba(255, 255, 255, 0.18)';
    captionElement.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
    
    // Remove old style sheets
    const existingStyle = document.getElementById('dynamic-caption-styles');
    if (existingStyle) {
        existingStyle.remove();
    }
    
    // Also update interim style
    const styleSheet = document.createElement('style');
    styleSheet.id = 'dynamic-caption-styles';
    styleSheet.textContent = `
        .caption-text.interim {
            background: ${hexToRgba(bgColor, Math.max(15, bgOpacity * 50))} !important;
            backdrop-filter: blur(15px) saturate(150%) !important;
            -webkit-backdrop-filter: blur(15px) saturate(150%) !important;
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