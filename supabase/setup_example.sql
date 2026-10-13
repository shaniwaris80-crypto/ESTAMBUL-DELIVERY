-- USAR SOLO CON CUENTAS DE PRUEBA.
-- 1) Primero crear los usuarios en Authentication → Users.
-- 2) Sustituir los 3 correos. Ejecutar una vez; NO sobre datos de clientes.
do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_account uuid; v_ra uuid; v_rb uuid;
begin
 select id into v_admin from auth.users where email='SUPERVISOR@EXAMPLE.TEST';
 select id into v_a from auth.users where email='RIDER-A@EXAMPLE.TEST';
 select id into v_b from auth.users where email='RIDER-B@EXAMPLE.TEST';
 if v_admin is null or v_a is null or v_b is null or
    v_admin=v_a or v_admin=v_b or v_a=v_b then
    raise exception 'Primero crea TRES usuarios distintos y sustituye los correos de ejemplo';
 end if;
 insert into public.ed_accounts(name) values('ESTAMBUL DEMO') returning id into v_account;
 insert into public.ed_members(account_id,user_id,role) values
    (v_account,v_admin,'admin'),(v_account,v_a,'rider'),(v_account,v_b,'rider');
 insert into public.ed_riders(account_id,user_id,display_name,active)
 values(v_account,v_a,'Rider A',true) returning id into v_ra;
 insert into public.ed_riders(account_id,user_id,display_name,active)
 values(v_account,v_b,'Rider B',true) returning id into v_rb;
 insert into public.ed_orders(account_id,reference,channel,customer_name,destination,lat,lng,amount,status,rider_id)
 values
  (v_account,'TEST-1001','test','Cliente ficticio 1','Burgos · destino de prueba',42.346,-3.699,12.50,'asignado',v_ra),
  (v_account,'TEST-1002','test','Cliente ficticio 2','Burgos · destino de prueba',42.351,-3.67,18.30,'pendiente',null),
  (v_account,'TEST-1003','test','Cliente ficticio 3','Burgos · destino de prueba',42.342,-3.689,22.10,'asignado',v_rb);
 raise notice 'Cuenta creada: % | Rider A: % | Rider B: %',v_account,v_ra,v_rb;
end $$;
