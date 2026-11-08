/* Marks the page as running inside the desktop app so desktop.css can adapt the chrome
   (e.g. room for the macOS traffic lights and a draggable top bar). No Node access is exposed. */
'use strict';
const mark = () => document.documentElement.classList.add('app-shell', `app-${process.platform}`);
if (document.documentElement) mark();
window.addEventListener('DOMContentLoaded', mark);
