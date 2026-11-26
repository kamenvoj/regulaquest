-- RegulaQuest · 05 · Zachování odstavců při čištění HTML z editoru
-- Prohlížeč ukládá vložené odstavce jako <div>/<p>; dříve se odstranily i se zalomením a text splynul.
-- Nyní se začátek odstavce převede na <br>, nadbytečná prázdná zalomení se sloučí. Lze spustit opakovaně.

create or replace function rq_private.clean_html(p text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(coalesce(p, ''), '<(script|style|iframe|object|svg|math|template)[^>]*>.*?</\1\s*>', '', 'gis'),
                 '<(p|div|li|h[1-6]|blockquote|tr)(\s[^>]*)?>', '<br>', 'gi'),
               '<(b|strong|i|em|u)\s[^>]*>', '<\1>', 'gi'),
             '<(?!/?(b|strong|i|em|u)>|br\s*/?>)[^>]*>', '', 'gi'),
           '(\s*<br\s*/?>\s*){3,}', '<br><br>', 'gi'),
         '^(\s*<br\s*/?>)+', '', 'i'),
       '(<br\s*/?>\s*)+$', '', 'i')
$$;
