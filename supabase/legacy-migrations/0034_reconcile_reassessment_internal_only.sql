-- Makes reconcile_reassessment_ticket_state() internal: only the reassessment
-- RPCs and service_role call it, so signed-in clients can no longer rewrite
-- or read a ticket's status through it.

revoke execute on function reconcile_reassessment_ticket_state(uuid) from authenticated;
