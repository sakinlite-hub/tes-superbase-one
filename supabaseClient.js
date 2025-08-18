// Initializes Supabase using config.js globals
// Ensure you create config.js from config.example.js with your keys.

if (typeof window.SUPABASE_URL === 'undefined' || typeof window.SUPABASE_ANON_KEY === 'undefined') {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY. Create config.js from config.example.js');
}

// The UMD build exposes window.supabase.createClient
if (!window.supabase || !window.supabase.createClient) {
  console.error('Supabase JS SDK not loaded. Ensure <script src="https://unpkg.com/@supabase/supabase-js@2"></script> is included before this file.');
} else {
  // Resilient storage: prefer localStorage, fall back to sessionStorage (avoid cookies due to 4KB limits on tokens)
  function storageLog(action, key, extra) {
    try {
      if (typeof key === 'string' && (key.includes('sb-') || key.includes('supabase') || key.includes('cc-auth-backup'))) {
        console.debug('[Storage]', action, key, extra || '');
      }
    } catch {}
  }
  const resilientStorage = {
    getItem: (key) => {
      try { const v = window.localStorage.getItem(key); if (v != null) { storageLog('get(ls)', key, 'hit'); return v; } } catch {}
      try { const v2 = window.sessionStorage.getItem(key); if (v2 != null) { storageLog('get(ss)', key, 'hit'); return v2; } } catch {}
      storageLog('get(miss)', key);
      return null;
    },
    setItem: (key, value) => {
      let wrote = false;
      try { window.localStorage.setItem(key, value); wrote = true; storageLog('set(ls)', key, (value||'').length); } catch (e) { storageLog('set(ls:err)', key, e && e.message); }
      try { window.sessionStorage.setItem(key, value); wrote = true; storageLog('set(ss)', key, (value||'').length); } catch (e) { storageLog('set(ss:err)', key, e && e.message); }
      return wrote;
    },
    removeItem: (key) => {
      try { window.localStorage.removeItem(key); storageLog('rm(ls)', key); } catch {}
      try { window.sessionStorage.removeItem(key); storageLog('rm(ss)', key); } catch {}
    }
  };

  // Quick diagnostics to understand mobile behavior
  (function testStorageWritability(){
    let ls = false, ss = false;
    try { window.localStorage.setItem('__cc_test', '1'); ls = true; } catch {}
    try { window.sessionStorage.setItem('__cc_test', '1'); ss = true; } catch {}
    try { window.localStorage.removeItem('__cc_test'); } catch {}
    try { window.sessionStorage.removeItem('__cc_test'); } catch {}
    try { console.debug('[Storage] writable', { ls, ss, ua: navigator.userAgent }); } catch {}
  })();

  // Helper to dump current auth-related keys quickly from console
  window.dumpAuthStorage = function dumpAuthStorage() {
    const ls = []; const ss = [];
    try { for (const k in window.localStorage) if (k && (k.includes('sb-') || k.includes('supabase') || k.includes('cc-auth-backup'))) ls.push(k); } catch {}
    try { for (const k in window.sessionStorage) if (k && (k.includes('sb-') || k.includes('supabase') || k.includes('cc-auth-backup'))) ss.push(k); } catch {}
    const out = { url: location.href, ls, ss };
    try { console.debug('[Storage] dump', out); } catch {}
    return out;
  };

  // Factory to create a new Supabase client instance
  window.makeSupabaseClient = function makeSupabaseClient() {
    return window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
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
  };
  // Initialize default instance
  window.sb = window.makeSupabaseClient();
}
