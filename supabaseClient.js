// Initializes Supabase using config.js globals
// Ensure you create config.js from config.example.js with your keys.

if (typeof window.SUPABASE_URL === 'undefined' || typeof window.SUPABASE_ANON_KEY === 'undefined') {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY. Create config.js from config.example.js');
}

// The UMD build exposes window.supabase.createClient
if (!window.supabase || !window.supabase.createClient) {
  console.error('Supabase JS SDK not loaded. Ensure <script src="https://unpkg.com/@supabase/supabase-js@2"></script> is included before this file.');
} else {
  // Do NOT overwrite window.supabase (namespace). Create a client instance as window.sb
  window.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'calcchat-auth'
    },
    realtime: {
      params: { eventsPerSecond: 20 }
    }
  });
}
