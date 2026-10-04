import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://tofrboakpcmjvrixxxtl.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZnJib2FrcGNtanZyaXh4eHRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MDAwMTMsImV4cCI6MjEwNTA3NjAxM30.Jhcwt6L6tejlm4_bQpc_39_MkkuDv6P8H2cTAHuZO8g'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)