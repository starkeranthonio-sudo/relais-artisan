import { createClient } from "@supabase/supabase-js";

// Clé « publishable » : publique par conception. La sécurité repose sur les règles RLS de la base.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
);
