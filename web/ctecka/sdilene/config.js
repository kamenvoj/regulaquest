// Společné nastavení Studia a čtečky. Klíč je veřejný záměrně: bez pravidel přístupu
// v databázi nic neodemkne (viz supabase/README.md).
window.RQ_CONFIG = Object.freeze({
  supabaseUrl: 'https://nalzqiaypbguzqukikej.supabase.co',
  supabaseKey: 'sb_publishable_ANEFmuyEIoZ0W5L678vT0g_Nd5JZDO7',
  // Uživatel zadává jen jméno; aplikace doplní adresu podle typu účtu.
  adminDomain: 'admin.regulaquest.cz',
  studentDomain: 'studenti.regulaquest.invalid',
  studentPrefix: 'rq-',
  readerUrl: 'https://regulaquest.pages.dev',
  studioUrl: 'https://regulaquest-studio.pages.dev',
  accountsFunction: 'ucty'
});
