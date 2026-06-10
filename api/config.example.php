<?php
// ============================================================================
// COPY THIS FILE TO  config.php  (on the server) AND FILL IN REAL VALUES.
// config.php is gitignored and must NEVER be committed — it holds the DB password.
// Create it via Hostinger hPanel → File Manager inside the /api folder.
// ============================================================================
return [
  // From hPanel → Databases → MySQL Databases (after you create the DB + user):
  'db_host'     => 'localhost',          // Hostinger is usually 'localhost'
  'db_name'     => 'REPLACE_db_name',    // e.g. u123456789_redwoods
  'db_user'     => 'REPLACE_db_user',    // e.g. u123456789_rwd
  'db_pass'     => 'REPLACE_db_password',

  // A secret you choose. Anyone creating an account must enter this code,
  // so the public can't register on your dashboard. Share it only with your team.
  'signup_code' => 'REPLACE_with_a_secret_signup_code',
];
