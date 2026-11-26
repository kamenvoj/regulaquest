-- RegulaQuest · 04 · Účet správce
-- Spusťte až po založení uživatele v Authentication → Users. Lze spustit opakovaně.
insert into public.profiles (user_id, username, display_name, role)
select id, 'vojta', 'Vojta', 'owner' from auth.users where email = 'vojta@admin.regulaquest.cz'
on conflict (user_id) do update set role = 'owner', active = true;

select username, display_name, role, active from public.profiles where role = 'owner';
