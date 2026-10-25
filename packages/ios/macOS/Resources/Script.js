function show(platform, enabled, useSettingsInsteadOfPreferences) {
    document.body.classList.add(`platform-${platform}`);

    if (useSettingsInsteadOfPreferences) {
        document.getElementsByClassName('platform-mac state-on')[0].innerText = "Byoky’s extension is currently on. You can turn it off in the Extensions section of Safari Settings.";
        document.getElementsByClassName('platform-mac state-off')[0].innerText = "Byoky’s extension is currently off. You can turn it on in the Extensions section of Safari Settings.";
        document.getElementsByClassName('platform-mac state-unknown')[0].innerText = "You can turn on Byoky’s extension in the Extensions section of Safari Settings.";
        document.getElementsByClassName('platform-mac open-preferences')[0].innerText = "Quit and Open Safari Settings…";
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);

// Muninn watches the pointer: the head tilts toward it (up to ±16°), the
// bird turns to face it, the pupil follows and it blinks every ~4s. Under
// reduced motion it holds still. See docs/brand/README.md, "The raven".
(function () {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const svg = document.getElementById("muninn");
    const raven = document.getElementById("raven");
    const head = document.getElementById("head");
    const eye = document.getElementById("eye");
    const pupil = document.getElementById("pupil");
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

    document.addEventListener("mousemove", (event) => {
        const box = svg.getBoundingClientRect();
        const scale = box.width / 240;
        const dx = event.clientX - (box.left + 150 * scale);
        const dy = event.clientY - (box.top + 70 * scale);
        const facesLeft = dx < -20;
        const ahead = facesLeft ? -dx : dx;
        raven.style.transform = facesLeft ? "scaleX(-1)" : "none";
        head.style.transform = `rotate(${clamp(dy * 0.06, -16, 16)}deg)`;
        pupil.style.transform = `translate(${clamp(ahead / 40, -1, 2.6)}px, ${clamp(dy / 40, -2.4, 2.4)}px)`;
    });

    setInterval(() => {
        eye.setAttribute("ry", "0.8");
        pupil.setAttribute("visibility", "hidden");
        setTimeout(() => {
            eye.setAttribute("ry", "7");
            pupil.setAttribute("visibility", "visible");
        }, 140);
    }, 4000);
})();
