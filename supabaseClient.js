// Initializes Supabase using config.js globals
// Ensure you create config.js from config.example.js with your keys.

if (typeof window.SUPABASE_URL === 'undefined' || typeof window.SUPABASE_ANON_KEY === 'undefined') {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY. Create config.js from config.example.js');
}

// The UMD build exposes window.supabase.createClient
if (!window.supabase || !window.supabase.createClient) {
  console.error('Supabase JS SDK not loaded. Ensure <script src="https://unpkg.com/@supabase/supabase-js@2"></script> is included before this file.');
} else {
  // Resilient storage: prefer localStorage, fall back to cookies (helps on iOS Safari where storage can be purged on reload)
  function setCookie(name, value, days) {
    try {
      const d = new Date();
      d.setTime(d.getTime() + (days*24*60*60*1000));
      const expires = 'expires=' + d.toUTCString();
      document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value || '')};${expires};path=/;SameSite=Lax`;
    } catch {}
  }
  function getCookie(name) {
    try {
      const n = encodeURIComponent(name) + '=';
      const ca = document.cookie.split(';');
      for (let c of ca) {
        while (c.charAt(0) === ' ') c = c.substring(1);
        if (c.indexOf(n) === 0) return decodeURIComponent(c.substring(n.length, c.length));
      }
    } catch {}
    return null;
  }
  function delCookie(name) {
    try { document.cookie = `${encodeURIComponent(name)}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`; } catch {}
  }
  const resilientStorage = {
    getItem: (key) => {
      try { const v = window.localStorage.getItem(key); if (v != null) return v; } catch {}
      return getCookie(key);
    },
    setItem: (key, value) => {
      try { window.localStorage.setItem(key, value); } catch {}
      try { setCookie(key, value, 30); } catch {}
    },
    removeItem: (key) => {
      try { window.localStorage.removeItem(key); } catch {}
      try { delCookie(key); } catch {}
    }
  };

  // Do NOT overwrite window.supabase (namespace). Create a client instance as window.sb
  window.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: resilientStorage,
    },
    realtime: {
      params: { eventsPerSecond: 20 }
    }
  });
}
