const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function test() {
  console.log('Testing Supabase connection...');
  console.log('URL:', process.env.SUPABASE_URL);
  
  const { data, error } = await supabase
    .from('users')
    .select('id, phone')
    .limit(1);
  
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('Success! Users found:', data);
  }
}

test();