document.querySelectorAll('.deltarune-wavy').forEach(c => { 
    const t = c.dataset.text || c.textContent; 
    c.textContent = '';
    [...t].forEach((ch, i) => { 
        const s = document.createElement('span'); 
        s.textContent = ch === ' ' ? '\u00A0' : ch; 
        s.style = `--i:${i}`; 
        c.appendChild(s); 
    }); 
});
function speakText(message) {
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 1.0;  // Speed (0.1 to 10)
    utterance.pitch = 1.0; // Pitch (0 to 2)
    utterance.volume = 1.0 // Volume (0 to 1)
    window.speechSynthesis.speak(utterance);
}
(function initThemeMonitor() {
    const themeMeta = document.getElementById('theme-meta');
    if (!themeMeta) {
        const meta = document.createElement('meta');
        meta.id = 'theme-meta';
        meta.name = 'theme-color';
        document.head.appendChild(meta);
    }
    function updateThemeColor() {
        const rootStyles = getComputedStyle(document.documentElement);
        const brandColor = rootStyles.getPropertyValue('--bg-main').trim();
        
        if (brandColor) {
            document.getElementById('theme-meta').setAttribute('content', brandColor);
        }
    }
    updateThemeColor();
    const observer = new MutationObserver(updateThemeColor);
    observer.observe(document.documentElement, { 
        attributes: true, 
        attributeFilter: ['class', 'data-theme', 'style'] 
    });
})();