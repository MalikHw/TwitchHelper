const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

let checkInterval = 30;
let intervalId = null;

// Load settings and start checking
chrome.storage.local.get(['checkInterval'], (result) => {
  if (result.checkInterval) {
    checkInterval = result.checkInterval;
  }
  startChecking();
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'updateInterval') {
    checkInterval = message.interval;
    startChecking();
  } else if (message.type === 'streamerLive') {
    showNotification(message.streamer, message.title);
  }
});

function startChecking() {
  if (intervalId) {
    clearInterval(intervalId);
  }
  
  checkStreams();
  intervalId = setInterval(checkStreams, checkInterval * 1000);
}

async function checkStreams() {
  try {
    const result = await chrome.storage.local.get(['streamers']);
    const streamers = result.streamers || [];
    
    if (streamers.length === 0) return;
    
    const usernames = streamers.map(s => s.username).join('&user_login=');
    
    const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${usernames}`, {
      headers: { 'Client-ID': CLIENT_ID }
    });
    const data = await res.json();
    
    const liveStreams = data.data || [];
    let notificationsShown = 0;
    
    streamers.forEach(streamer => {
      const liveData = liveStreams.find(s => s.user_login === streamer.username);
      const wasLive = streamer.isLive;
      
      if (liveData) {
        streamer.isLive = true;
        streamer.title = liveData.title;
        streamer.game = liveData.game_name;
        streamer.viewers = liveData.viewer_count;
        
        // Show notification if just went live
        if (!wasLive && notificationsShown < 3) {
          showNotification(streamer.displayName, streamer.title);
          notificationsShown++;
        }
      } else {
        streamer.isLive = false;
        streamer.title = '';
        streamer.game = '';
        streamer.viewers = 0;
      }
    });
    
    // Save updated streamer states
    await chrome.storage.local.set({ streamers });
  } catch (err) {
    console.error('Background check error:', err);
  }
}

function showNotification(streamer, title) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title: `${streamer} is now LIVE!`,
    message: title || 'Click to watch the stream',
    priority: 2
  }, (notificationId) => {
    // Store notification data for click handling
    chrome.storage.local.set({
      [`notification_${notificationId}`]: streamer
    });
  });
}

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.storage.local.get([`notification_${notificationId}`], (result) => {
    const streamer = result[`notification_${notificationId}`];
    if (streamer) {
      chrome.tabs.create({
        url: `https://www.twitch.tv/${streamer}`
      });
      chrome.storage.local.remove([`notification_${notificationId}`]);
    }
  });
});
