do $$
begin
  if (select status from tickets where id = 'c0000000-0000-0000-0000-000000000001') <> 'fix_submitted' then
    raise exception 'historical fix_submitted ticket was not preserved';
  end if;
  if (select count(*) from ticket_control_steps where step_key = 'stable-step') <> 2 then
    raise exception 'selected-control step progress was not preserved';
  end if;
  if (select status from ticket_control_steps where id = '32000000-0000-0000-0000-000000000001') <> 'completed' then
    raise exception 'completed progress was not preserved';
  end if;
  if (select count(*) from risk_conversation_entries where conversation_id = 'd0000000-0000-0000-0000-00000000000a') <> 2 then
    raise exception 'conversation history was not preserved';
  end if;
  if (select storage_provider from risk_conversation_attachments where id = '33000000-0000-0000-0000-000000000001') <> 'supabase' then
    raise exception 'legacy attachment provider was not backfilled';
  end if;
  if (select size_bytes from risk_conversation_attachments where id = '33000000-0000-0000-0000-000000000001') is not null then
    raise exception 'legacy attachment size must remain unknown';
  end if;
  if (select previous_ticket_status from retest_runs where id = '34000000-0000-0000-0000-000000000001') <> 'fix_submitted' then
    raise exception 'historical reassessment restoration state was not preserved';
  end if;
end $$;
