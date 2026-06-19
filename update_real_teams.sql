-- Actualización de selecciones reales Mundial 2026
-- Úsalo solo si tienes una tabla teams en Supabase. La app actual usa data/teams.json y data/matches.json.

update public.teams set team_name='Czechia', fifa_code='CZE', is_placeholder=false where fifa_code='UEPD' or team_name='Winner UEFA Playoff D';
update public.teams set team_name='Bosnia & Herzegovina', fifa_code='BIH', is_placeholder=false where fifa_code='UEPA' or team_name='Winner UEFA Playoff A';
update public.teams set team_name='Türkiye', fifa_code='TUR', is_placeholder=false where fifa_code='UEPC' or team_name='Winner UEFA Playoff C';
update public.teams set team_name='Sweden', fifa_code='SWE', is_placeholder=false where fifa_code='UEPB' or team_name='Winner UEFA Playoff B';
update public.teams set team_name='Iraq', fifa_code='IRQ', is_placeholder=false where fifa_code='FP02' or team_name='Winner FIFA Playoff 2';
update public.teams set team_name='Congo DR', fifa_code='COD', is_placeholder=false where fifa_code='FP01' or team_name='Winner FIFA Playoff 1';
