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
  const resilientStorage = {
    getItem: (key) => {
      try { const v = window.localStorage.getItem(key); if (v != null) return v; } catch {}
      try { const v2 = window.sessionStorage.getItem(key); if (v2 != null) return v2; } catch {}
      return null;
    },
    setItem: (key, value) => {
      let ok = false;
      try { window.localStorage.setItem(key, value); ok = true; } catch {}
      if (!ok) { try { window.sessionStorage.setItem(key, value); ok = true; } catch {} }
      return ok;
    },
    removeItem: (key) => {
      try { window.localStorage.removeItem(key); } catch {}
      try { window.sessionStorage.removeItem(key); } catch {}
    }
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
