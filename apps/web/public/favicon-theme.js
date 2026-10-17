(() => {
  const script = document.currentScript;
  const base = new URL('.', script.src);
  const icon = document.getElementById('lucy-favicon');
  if (!icon || !window.matchMedia) return;
  const preference = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    const theme = preference.matches ? 'dark' : 'light';
    icon.href = new URL(`favicon-${theme}-32.png`, base).href;
  };
  update();
  if (preference.addEventListener) preference.addEventListener('change', update);
  else if (preference.addListener) preference.addListener(update);
  window.addEventListener('pageshow', update);
})();
