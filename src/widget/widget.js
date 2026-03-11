/*!
 * Glo Matrix Chat Widget
 * Embeddable: <script src="https://your-api.railway.app/widget.js" data-bot="marie"></script>
 */
(function () {
  "use strict";

  // ── Config from script tag ──────────────────────────────────────────
  const script = document.currentScript || document.querySelector('script[data-bot]');
  const API_BASE = script ? new URL(script.src).origin : window.GloWidget?.apiBase || "";
  const BOT_ID = (script && script.getAttribute("data-bot")) || "marie";
  const BRAND_COLOR = (script && script.getAttribute("data-color")) || "#8B5CF6";
  const BOT_LABEL = (script && script.getAttribute("data-name")) || "Marie";
  const GREETING = (script && script.getAttribute("data-greeting")) || "Hey! I'm Marie 👋 How can I help you today?";

  // ── State ───────────────────────────────────────────────────────────
  let sessionToken = null;
  let isOpen = false;
  let isTyping = false;
  let messageCount = 0;

  // ── Styles ──────────────────────────────────────────────────────────
  const css = `
    #glo-widget-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 99998;
      width: 56px; height: 56px; border-radius: 50%; border: none; cursor: pointer;
      background: ${BRAND_COLOR}; color: #fff; font-size: 24px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    #glo-widget-btn:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(0,0,0,0.3); }
    #glo-widget-btn svg { width: 26px; height: 26px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

    #glo-widget-window {
      position: fixed; bottom: 92px; right: 24px; z-index: 99999;
      width: 360px; height: 540px; max-height: calc(100vh - 110px);
      border-radius: 16px; overflow: hidden;
      background: #0f0f0f; border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      display: flex; flex-direction: column;
      transform: scale(0.9) translateY(10px); opacity: 0;
      transition: transform 0.25s cubic-bezier(.34,1.56,.64,1), opacity 0.2s ease;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #glo-widget-window.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: all; }

    #glo-widget-header {
      background: ${BRAND_COLOR}; padding: 14px 16px;
      display: flex; align-items: center; gap: 10px;
      border-radius: 16px 16px 0 0;
    }
    #glo-widget-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(255,255,255,0.25);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; font-weight: 700; color: #fff;
    }
    #glo-widget-header-info { flex: 1; }
    #glo-widget-name { font-size: 15px; font-weight: 600; color: #fff; line-height: 1.2; }
    #glo-widget-status { font-size: 12px; color: rgba(255,255,255,0.8); display: flex; align-items: center; gap: 4px; }
    #glo-widget-status::before { content: ''; display: inline-block; width: 7px; height: 7px; background: #4ade80; border-radius: 50%; }
    #glo-widget-close-btn {
      background: none; border: none; cursor: pointer; color: rgba(255,255,255,0.8);
      font-size: 20px; line-height: 1; padding: 2px; border-radius: 4px;
      transition: color 0.15s;
    }
    #glo-widget-close-btn:hover { color: #fff; }

    #glo-widget-messages {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 10px;
      scroll-behavior: smooth;
    }
    #glo-widget-messages::-webkit-scrollbar { width: 4px; }
    #glo-widget-messages::-webkit-scrollbar-track { background: transparent; }
    #glo-widget-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

    .glo-msg { max-width: 82%; display: flex; flex-direction: column; animation: gloPop 0.2s ease; }
    @keyframes gloPop { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .glo-msg.bot { align-self: flex-start; }
    .glo-msg.user { align-self: flex-end; }
    .glo-bubble {
      padding: 10px 13px; border-radius: 14px; font-size: 14px; line-height: 1.5;
    }
    .glo-msg.bot .glo-bubble { background: rgba(255,255,255,0.07); color: #e5e5e5; border-radius: 4px 14px 14px 14px; }
    .glo-msg.user .glo-bubble { background: ${BRAND_COLOR}; color: #fff; border-radius: 14px 14px 4px 14px; }

    .glo-typing { display: flex; align-items: center; gap: 4px; padding: 12px 13px; }
    .glo-dot { width: 7px; height: 7px; background: rgba(255,255,255,0.4); border-radius: 50%; animation: gloDot 1.4s infinite; }
    .glo-dot:nth-child(2) { animation-delay: 0.2s; }
    .glo-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes gloDot { 0%,80%,100% { transform: scale(0.7); opacity: 0.4; } 40% { transform: scale(1); opacity: 1; } }

    #glo-widget-input-row {
      padding: 12px 14px;
      border-top: 1px solid rgba(255,255,255,0.07);
      display: flex; gap: 8px; align-items: flex-end;
    }
    #glo-widget-input {
      flex: 1; background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px; padding: 9px 12px; color: #e5e5e5; font-size: 14px;
      resize: none; outline: none; max-height: 100px; min-height: 38px; font-family: inherit;
      line-height: 1.4;
      transition: border-color 0.15s;
    }
    #glo-widget-input::placeholder { color: rgba(255,255,255,0.3); }
    #glo-widget-input:focus { border-color: ${BRAND_COLOR}; }
    #glo-widget-send {
      width: 36px; height: 36px; border-radius: 8px; border: none;
      background: ${BRAND_COLOR}; color: #fff; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: opacity 0.15s;
    }
    #glo-widget-send:disabled { opacity: 0.4; cursor: not-allowed; }
    #glo-widget-send svg { width: 16px; height: 16px; fill: none; stroke: #fff; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }

    #glo-widget-branding {
      text-align: center; padding: 6px; font-size: 11px; color: rgba(255,255,255,0.2);
    }

    @media (max-width: 420px) {
      #glo-widget-window { width: calc(100vw - 16px); right: 8px; bottom: 80px; }
      #glo-widget-btn { bottom: 16px; right: 16px; }
    }
  `;

  // ── DOM ─────────────────────────────────────────────────────────────
  function inject() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    // Bubble button
    const btn = document.createElement("button");
    btn.id = "glo-widget-btn";
    btn.setAttribute("aria-label", "Open chat");
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    btn.addEventListener("click", toggleWidget);
    document.body.appendChild(btn);

    // Chat window
    const win = document.createElement("div");
    win.id = "glo-widget-window";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", "Chat with " + BOT_LABEL);
    win.innerHTML = `
      <div id="glo-widget-header">
        <div id="glo-widget-avatar">${BOT_LABEL[0]}</div>
        <div id="glo-widget-header-info">
          <div id="glo-widget-name">${BOT_LABEL}</div>
          <div id="glo-widget-status">Online</div>
        </div>
        <button id="glo-widget-close-btn" aria-label="Close chat">&#x2715;</button>
      </div>
      <div id="glo-widget-messages" role="log" aria-live="polite"></div>
      <div id="glo-widget-input-row">
        <textarea id="glo-widget-input" placeholder="Type a message..." rows="1" aria-label="Chat message"></textarea>
        <button id="glo-widget-send" aria-label="Send message">
          <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
      <div id="glo-widget-branding">Powered by Glo Matrix</div>
    `;
    document.body.appendChild(win);

    win.querySelector("#glo-widget-close-btn").addEventListener("click", closeWidget);
    const input = win.querySelector("#glo-widget-input");
    const sendBtn = win.querySelector("#glo-widget-send");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 100) + "px";
    });
    sendBtn.addEventListener("click", sendMessage);
  }

  // ── Session ─────────────────────────────────────────────────────────
  async function startSession() {
    try {
      const res = await fetch(`${API_BASE}/api/widget/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_id: BOT_ID }),
      });
      if (!res.ok) throw new Error("Session failed");
      const data = await res.json();
      sessionToken = data.token;
    } catch (e) {
      console.warn("[GloWidget] Session error:", e);
    }
  }

  // ── Widget Open/Close ────────────────────────────────────────────────
  async function toggleWidget() {
    isOpen ? closeWidget() : openWidget();
  }

  async function openWidget() {
    isOpen = true;
    const win = document.getElementById("glo-widget-window");
    const btn = document.getElementById("glo-widget-btn");
    win.classList.add("open");
    btn.innerHTML = `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

    if (!sessionToken) {
      await startSession();
      if (messageCount === 0) {
        addMessage("bot", GREETING);
      }
    }

    setTimeout(() => document.getElementById("glo-widget-input")?.focus(), 300);
  }

  function closeWidget() {
    isOpen = false;
    const win = document.getElementById("glo-widget-window");
    const btn = document.getElementById("glo-widget-btn");
    win.classList.remove("open");
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  }

  // ── Messages ─────────────────────────────────────────────────────────
  function addMessage(role, text) {
    messageCount++;
    const log = document.getElementById("glo-widget-messages");
    const msg = document.createElement("div");
    msg.className = `glo-msg ${role}`;
    const bubble = document.createElement("div");
    bubble.className = "glo-bubble";
    bubble.textContent = text;
    msg.appendChild(bubble);
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
    return msg;
  }

  function showTyping() {
    const log = document.getElementById("glo-widget-messages");
    const el = document.createElement("div");
    el.id = "glo-typing-indicator";
    el.className = "glo-msg bot";
    el.innerHTML = `<div class="glo-bubble glo-typing"><div class="glo-dot"></div><div class="glo-dot"></div><div class="glo-dot"></div></div>`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function removeTyping() {
    document.getElementById("glo-typing-indicator")?.remove();
  }

  async function sendMessage() {
    if (isTyping) return;
    const input = document.getElementById("glo-widget-input");
    const sendBtn = document.getElementById("glo-widget-send");
    const text = input.value.trim();
    if (!text || !sessionToken) return;

    input.value = "";
    input.style.height = "auto";
    addMessage("user", text);
    isTyping = true;
    sendBtn.disabled = true;
    showTyping();

    try {
      const res = await fetch(`${API_BASE}/api/widget/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Widget-Token": sessionToken,
        },
        body: JSON.stringify({ message: text }),
      });

      removeTyping();

      if (res.status === 429) {
        addMessage("bot", "You're moving fast! Give me just a moment to catch up. ⏳");
      } else if (res.status === 401) {
        addMessage("bot", "Your session expired. Please refresh the page to continue.");
        sessionToken = null;
      } else if (!res.ok) {
        addMessage("bot", "Something went wrong on my end. Please try again!");
      } else {
        const data = await res.json();
        addMessage("bot", data.reply || "...");
      }
    } catch (e) {
      removeTyping();
      addMessage("bot", "Connection issue. Please check your internet and try again.");
    } finally {
      isTyping = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }
})();
