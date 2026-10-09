/* Keep horizontal navigation visible and clear the dock while typing on phones. */
(() => {
  const phone = window.matchMedia('(max-width:700px)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion:reduce)');
  function reveal(button) {
    const rail = button.closest('.nav, .tabs');
    if (!phone.matches || !rail || !rail.scrollTo) return;
    const box = button.getBoundingClientRect(), bounds = rail.getBoundingClientRect();
    let delta = 0;
    if (box.left < bounds.left + 12) delta = box.left - bounds.left - 12;
    else if (box.right > bounds.right - 12) delta = box.right - bounds.right + 12;
    if (delta) rail.scrollTo({left:rail.scrollLeft + delta,behavior:reduceMotion.matches?'auto':'smooth'});
  }
  document.addEventListener('click', event => {
    const button = event.target.closest?.('#portal .nav button, #portal .tabs button');
    if (button) reveal(button);
  });
  const portal = document.getElementById('portal');
  if (portal) new MutationObserver(records => {
    for (const record of records) {
      const button = record.target;
      if (button.matches?.('.nav button.on, .tabs button.on')) reveal(button);
    }
  }).observe(portal,{subtree:true,attributes:true,attributeFilter:['class']});
  function updateKeyboard() {
    const active = document.activeElement;
    const editing = active?.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), [contenteditable="true"]');
    // Hide only during editing: this also works with browsers that resize layout height.
    document.body.classList.toggle('clinician-keyboard-open',phone.matches && !!editing);
  }
  document.addEventListener('focusin',updateKeyboard);
  document.addEventListener('focusout',() => setTimeout(updateKeyboard,0));
  window.addEventListener('resize',updateKeyboard);
})();
