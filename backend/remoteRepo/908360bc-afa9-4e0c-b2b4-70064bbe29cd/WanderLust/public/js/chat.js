document.addEventListener('DOMContentLoaded', () => {
  const chatOpenBtn = document.getElementById('chat-open-btn');
  const chatWidget = document.getElementById('chat-widget');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatMessages = document.getElementById('chat-messages');

  function appendMessage(sender, text) {
    const el = document.createElement('div');
    el.className = `chat-msg ${sender}`;
    el.textContent = text;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  chatOpenBtn.addEventListener('click', () => {
    chatWidget.classList.toggle('open');
    chatInput.focus();
  });

  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = chatInput.value.trim();
    if (!message) return;
    appendMessage('user', message);
    chatInput.value = '';
    appendMessage('bot', 'Thinking...');

    try {
      const resp = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await resp.json();
      // remove the 'Thinking...' placeholder
      const last = chatMessages.querySelector('.chat-msg.bot:last-child');
      if (last && last.textContent === 'Thinking...') last.remove();
      appendMessage('bot', data.reply || 'Sorry, no answer.');
    } catch (err) {
      console.error(err);
      appendMessage('bot', 'Error contacting server.');
    }
  });
});
