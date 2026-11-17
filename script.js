const applyTheme = (theme) => {
    if (theme) {
        document.body.className = theme;
    } else {
        document.body.className = "";
    }
};

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
                        } catch (e) {}
                    };
                }, 150);
            });
        });
    }
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