const applyTheme = (theme) => {
    if (theme) {
        document.body.className = theme;
    } else {
        document.body.className = "";
    }
};

let activeHighlightedElement = null;
let isReadAloudEnabled = false;

const stopReading = () => {
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    document.querySelectorAll(".highlighted").forEach(el => el.classList.remove("highlighted"));
    try {
        const iframes = document.querySelectorAll("iframe");
        iframes.forEach(iframe => {
            try {
                iframe.contentWindow.postMessage({ type: "STOP_READING" }, "*");
            } catch (e) {}
        });
    } catch (e) {}
    activeHighlightedElement = null;
};

const setReadAloudActive = (active, broadcast = true) => {
    isReadAloudEnabled = active;
    const topReadAloud = document.querySelector(".topbar-readaloud");
    if (topReadAloud) {
        if (active) {
            topReadAloud.classList.add("activated");
        } else {
            topReadAloud.classList.remove("activated");
        }
    }

    if (active) {
        document.body.classList.add("read-aloud-active");
    } else {
        document.body.classList.remove("read-aloud-active");
        stopReading();
    }

    try {
        const iframes = document.querySelectorAll("iframe");
        iframes.forEach(iframe => {
            try {
                iframe.contentWindow.postMessage({ type: "SET_READ_ALOUD", active }, "*");
            } catch (e) {}
        });
    } catch (e) {}

    if (broadcast && window !== window.top) {
        try {
            window.top.postMessage({ type: "SET_READ_ALOUD", active }, "*");
        } catch (e) {}
    }
};

window.addEventListener("message", (event) => {
    if (!event.data) return;
    if (event.data.type === "SET_READ_ALOUD") {
        isReadAloudEnabled = event.data.active;
        if (isReadAloudEnabled) {
            document.body.classList.add("read-aloud-active");
            const topReadAloud = document.querySelector(".topbar-readaloud");
            if (topReadAloud) topReadAloud.classList.add("activated");
        } else {
            document.body.classList.remove("read-aloud-active");
            const topReadAloud = document.querySelector(".topbar-readaloud");
            if (topReadAloud) topReadAloud.classList.remove("activated");
            stopReading();
        }
    } else if (event.data.type === "STOP_READING") {
        stopReading();
    }
});

document.addEventListener("DOMContentLoaded", () => {
    const currentTheme = localStorage.getItem("theme") || "";
    applyTheme(currentTheme);

    const select = document.querySelector("select");
    if (select) {
        Array.from(select.options).forEach(option => {
            if (option.getAttribute("data-themename") === currentTheme) {
                option.selected = true;
            }
        });

        select.addEventListener("change", () => {
            const selectedOption = select.options[select.selectedIndex];
            const themeName = selectedOption.getAttribute("data-themename") || "";
            localStorage.setItem("theme", themeName);
            applyTheme(themeName);

            try {
                const iframes = window.top.document.querySelectorAll("iframe");
                iframes.forEach(iframe => {
                    try {
                        iframe.contentWindow.document.body.className = themeName;
                    } catch (e) {}
                });
            } catch (e) {}
        });
    }

    const navLinks = document.querySelectorAll(".nav-link");
    const iframe = document.querySelector("iframe[name='mainframe']");

    if (navLinks.length && iframe) {
        navLinks.forEach(link => {
            link.addEventListener("click", (e) => {
                e.preventDefault();
                const targetUrl = link.getAttribute("href");

                if (iframe.getAttribute("src") === targetUrl) return;

                iframe.classList.add("fade-out");

                setTimeout(() => {
                    iframe.src = targetUrl;
                    iframe.onload = () => {
                        iframe.classList.remove("fade-out");
                        try {
                            const currentTheme = localStorage.getItem("theme") || "";
                            iframe.contentWindow.document.body.className = currentTheme;
                            if (isReadAloudEnabled) {
                                iframe.contentWindow.postMessage({ type: "SET_READ_ALOUD", active: true }, "*");
                            }
                        } catch (e) {}
                    };
                }, 150);
            });
        });
    }

    const readAloudBtn = document.querySelector(".topbar-readaloud");
    if (readAloudBtn) {
        readAloudBtn.addEventListener("click", () => {
            const newState = !isReadAloudEnabled;
            setReadAloudActive(newState, true);
        });
    }

    const textSelectors = "p, a, h1, h2, h3, h4, h5, h6, span, li, label, td, th, blockquote";

    document.addEventListener("mouseover", (e) => {
        if (!isReadAloudEnabled) return;
        const target = e.target.closest(textSelectors);
        if (target && target !== readAloudBtn && !target.closest(".topbar")) {
            if (!target.classList.contains("highlighted") && target !== activeHighlightedElement) {
                target.classList.add("highlighted");
            }
        }
    });

    document.addEventListener("mouseout", (e) => {
        if (!isReadAloudEnabled) return;
        const target = e.target.closest(textSelectors);
        if (target && target !== activeHighlightedElement) {
            target.classList.remove("highlighted");
        }
    });

    document.addEventListener("click", (e) => {
        if (!isReadAloudEnabled) return;
        const target = e.target.closest(textSelectors);
        if (target && target !== readAloudBtn && !target.closest(".topbar")) {
            e.preventDefault();
            e.stopPropagation();

            if (activeHighlightedElement === target) {
                stopReading();
                return;
            }

            stopReading();

            activeHighlightedElement = target;
            target.classList.add("highlighted");

            if (window.speechSynthesis) {
                const textToRead = target.innerText || target.textContent;
                if (textToRead && textToRead.trim()) {
                    const utterance = new SpeechSynthesisUtterance(textToRead);
                    utterance.onend = () => {
                        target.classList.remove("highlighted");
                        if (activeHighlightedElement === target) {
                            activeHighlightedElement = null;
                        }
                    };
                    utterance.onerror = () => {
                        target.classList.remove("highlighted");
                        if (activeHighlightedElement === target) {
                            activeHighlightedElement = null;
                        }
                    };
                    window.speechSynthesis.speak(utterance);
                }
            }
        } else if (target === readAloudBtn) {
            stopReading();
        }
    });
});

window.addEventListener("storage", (e) => {
    if (e.key === "theme") {
        applyTheme(e.newValue || "");
        const select = document.querySelector("select");
        if (select) {
            Array.from(select.options).forEach(option => {
                if (option.getAttribute("data-themename") === (e.newValue || "")) {
                    option.selected = true;
                }
            });
        }
    }
});