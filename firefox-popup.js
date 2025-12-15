// Twitch API Client ID (anonymous/public access)
const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

let streamers = [];
let checkInterval = 30;
let currentChatChannel = null;
let ws = null;

// Load saved data
browser.storage.local.get(['streamers', 'checkInterval']).then((result) => {
  if (result.streamers) {
    streamers = result.streamers;
  }
  if (result.checkInterval) {
    checkInterval = result.checkInterval;
    document.getElementById('intervalInput').value = checkInterval;
  }
  renderStreamers();
  checkAllStreamers();
});

// Add streamer
document.getElementById('addBtn').addEventListener('click', addStreamer);
document.getElementById('usernameInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addStreamer();
});

async function addStreamer() {
  const input = document.getElementById('usernameInput');
  const username = input.value.trim().toLowerCase();
  
  if (!username) return;
  
  if (streamers.find(s => s.username === username)) {
    alert('Streamer already added!');
    return;
  }
  
  // Fetch streamer info
  const info = await fetchStreamerInfo(username);
  
  if (!info) {
    alert('Streamer not found!');
    return;
  }
  
  streamers.push({
    username: username,
    displayName: info.display_name,
    followers: info.followers || 0,
    isLive: false,
    title: '',
    game: '',
    viewers: 0
  });
  
  saveStreamers();
  renderStreamers();
  checkAllStreamers();
  input.value = '';
}

async function fetchStreamerInfo(username) {
  try {
    const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
      headers: { 'Client-ID': CLIENT_ID }
    });
    const userData = await userRes.json();
    
    if (!userData.data || userData.data.length === 0) return null;
    
    const user = userData.data[0];
    
    const followRes = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${user.id}`, {
      headers: { 'Client-ID': CLIENT_ID }
    });
    const followData = await followRes.json();
    
    return {
      display_name: user.display_name,
      followers: followData.total || 0
    };
  } catch (err) {
    console.error('Error fetching streamer info:', err);
    return null;
  }
}

async function checkAllStreamers() {
  if (streamers.length === 0) return;
  
  const usernames = streamers.map(s => s.username).join('&user_login=');
  
  try {
    const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${usernames}`, {
      headers: { 'Client-ID': CLIENT_ID }
    });
    const data = await res.json();
    
    const liveStreams = data.data || [];
    
    streamers.forEach(streamer => {
      const liveData = liveStreams.find(s => s.user_login === streamer.username);
      const wasLive = streamer.isLive;
      
      if (liveData) {
        streamer.isLive = true;
        streamer.title = liveData.title;
        streamer.game = liveData.game_name;
        streamer.viewers = liveData.viewer_count;
        
        // Send notification if just went live
        if (!wasLive) {
          browser.runtime.sendMessage({
            type: 'streamerLive',
            streamer: streamer.displayName,
            title: streamer.title
          });
        }
      } else {
        streamer.isLive = false;
        streamer.title = '';
        streamer.game = '';
        streamer.viewers = 0;
      }
    });
    
    saveStreamers();
    renderStreamers();
  } catch (err) {
    console.error('Error checking streams:', err);
  }
}

function renderStreamers() {
  const list = document.getElementById('streamersList');
  
  if (streamers.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="nf nf-fa-user_plus"></i>
        <p>Add your favorite streamers to get started!</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = streamers.map(s => `
    <div class="streamer-card ${s.isLive ? 'live' : ''}" data-username="${s.username}">
      <div class="streamer-header">
        <div class="streamer-name">
          <span class="status-indicator ${s.isLive ? 'live' : ''}"></span>
          ${s.displayName}
        </div>
        <button class="remove-btn" data-username="${s.username}">
          <i class="nf nf-fa-trash"></i>
        </button>
      </div>
      <div class="streamer-info">
        <i class="nf nf-fa-users"></i> ${formatNumber(s.followers)} followers
      </div>
      ${s.isLive ? `
        <div class="streamer-info">
          <i class="nf nf-fa-gamepad"></i> ${s.game || 'No category'}
        </div>
        <div class="live-info">
          <i class="nf nf-fa-circle"></i> LIVE - ${formatNumber(s.viewers)} viewers
        </div>
      ` : ''}
    </div>
  `).join('');
  
  // Add event listeners
  document.querySelectorAll('.streamer-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.remove-btn')) return;
      const username = card.dataset.username;
      const streamer = streamers.find(s => s.username === username);
      if (streamer && streamer.isLive) {
        openChat(username, streamer.displayName);
      }
    });
  });
  
  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeStreamer(btn.dataset.username);
    });
  });
}

function removeStreamer(username) {
  streamers = streamers.filter(s => s.username !== username);
  saveStreamers();
  renderStreamers();
}

function openChat(channel, displayName) {
  currentChatChannel = channel;
  document.getElementById('chatTitle').innerHTML = `<i class="nf nf-fa-comments"></i> ${displayName}'s Chat`;
  document.getElementById('chatContainer').classList.add('active');
  document.getElementById('chatMessages').innerHTML = '<div class="empty-state"><i class="nf nf-fa-spinner"></i><p>Connecting to chat...</p></div>';
  
  connectToChat(channel);
}

function connectToChat(channel) {
  if (ws) {
    ws.close();
  }
  
  ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
  
  ws.onopen = () => {
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
    ws.send('NICK justinfan12345');
    ws.send(`JOIN #${channel}`);
  };
  
  ws.onmessage = (event) => {
    const messages = event.data.split('\r\n');
    
    messages.forEach(message => {
      if (message.includes('PRIVMSG')) {
        const username = message.match(/:(.+)!/)?.[1] || 'Anonymous';
        const text = message.split('PRIVMSG')[1]?.split(':').slice(1).join(':').trim() || '';
        
        if (text) {
          addChatMessage(username, text);
        }
      }
      
      if (message.includes('PING')) {
        ws.send('PONG :tmi.twitch.tv');
      }
    });
  };
  
  ws.onerror = () => {
    document.getElementById('chatMessages').innerHTML = '<div class="empty-state"><i class="nf nf-fa-exclamation_triangle"></i><p>Failed to connect to chat</p></div>';
  };
}

function addChatMessage(username, text) {
  const messagesDiv = document.getElementById('chatMessages');
  
  // Remove empty state if present
  if (messagesDiv.querySelector('.empty-state')) {
    messagesDiv.innerHTML = '';
  }
  
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message';
  msgDiv.innerHTML = `<span class="username">${escapeHtml(username)}:</span><span class="text">${escapeHtml(text)}</span>`;
  
  messagesDiv.appendChild(msgDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  
  // Keep only last 100 messages
  while (messagesDiv.children.length > 100) {
    messagesDiv.removeChild(messagesDiv.firstChild);
  }
}

document.getElementById('backBtn').addEventListener('click', () => {
  document.getElementById('chatContainer').classList.remove('active');
  if (ws) {
    ws.close();
    ws = null;
  }
});

// Interval setting
document.getElementById('intervalInput').addEventListener('change', (e) => {
  let val = parseInt(e.target.value);
  if (val < 10) val = 10;
  checkInterval = val;
  browser.storage.local.set({ checkInterval });
  browser.runtime.sendMessage({ type: 'updateInterval', interval: checkInterval });
});

function saveStreamers() {
  browser.storage.local.set({ streamers });
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Check streams periodically while popup is open
setInterval(checkAllStreamers, checkInterval * 1000);
