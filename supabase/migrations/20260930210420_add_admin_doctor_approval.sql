-- Admins can update verification_status (and nothing else, still) on any doctor.
create policy "Admins can update doctor verification"
  on doctors for update
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'ADMIN')
  );

grant update (verification_status) on doctors to authenticated;

-- Admins need to see ALL doctors (not just approved ones) to review pending ones.
create policy "Admins can view all doctors"
  on doctors for select
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'ADMIN')
  ); 