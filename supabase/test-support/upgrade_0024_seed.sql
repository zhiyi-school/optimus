set session_replication_role = replica;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'developer@example.test'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'security@example.test');

insert into profiles (id, email, display_name, roles) values
  ('11111111-1111-1111-1111-111111111111', 'developer@example.test', 'Example Developer', array['developer']),
  ('22222222-2222-2222-2222-222222222222', 'security@example.test', 'Example Security', array['security']);

insert into teams (id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Example Developer Team', 'developer');
update profiles set team_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
where id = '11111111-1111-1111-1111-111111111111';

insert into applications (id, external_id, name, platform, developer_team_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'example_app', 'Example Application', 'ios', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
insert into assessments (id, external_id, application_id, status, total_tests, completed_tests) values
  ('b0000000-0000-0000-0000-00000000000a', 'run::historical', 'a0000000-0000-0000-0000-00000000000a', 'completed', 2, 2);
insert into findings (id, external_id, application_id, assessment_id, test_id, title, severity, status, platform) values
  ('f0000000-0000-0000-0000-00000000000a', 'example_app::example-risk', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'ios-feature-01-risk-01', 'Example finding', 'high', 'at_risk', 'ios');

insert into risk_conversations (id, application_id, origin_assessment_id, risk_id, finding_id) values
  ('d0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'ios-feature-01-risk-01', 'f0000000-0000-0000-0000-00000000000a');

insert into tickets (id, finding_id, application_id, type, status, title, created_by, assigned_team_id, risk_conversation_id, origin_assessment_id, selected_control_id) values
  ('c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'remediation', 'fix_submitted', 'Historical remediation', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'ios-feature-01-risk-01-control-01'),
  ('c0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'remediation', 'in_progress', 'Current remediation', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'd0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'ios-feature-01-risk-01-control-01');

insert into ticket_controls (id, ticket_id, control_id, status, developer_note) values
  ('31000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'ios-feature-01-risk-01-control-01', 'completed', 'Historical note'),
  ('31000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'ios-feature-01-risk-01-control-01', 'in_progress', 'Current note');
insert into ticket_control_steps (id, ticket_control_id, step_key, status, completed_by, completed_at, developer_note) values
  ('32000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'stable-step', 'completed', '11111111-1111-1111-1111-111111111111', now(), 'Done'),
  ('32000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000002', 'stable-step', 'not_started', null, null, 'Pending');

insert into risk_conversation_entries (id, conversation_id, kind, author_id, message, source_ticket_id) values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-00000000000a', 'message', '11111111-1111-1111-1111-111111111111', 'Historical conversation message', 'c0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000a', 'fix_submitted', '11111111-1111-1111-1111-111111111111', 'Historical workflow event', 'c0000000-0000-0000-0000-000000000001');
insert into risk_conversation_attachments (id, entry_id, uploaded_by, storage_path, file_name, mime_type) values
  ('33000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'conversation-d0000000-0000-0000-0000-00000000000a/example.txt', 'example.txt', 'text/plain');

insert into retest_runs (id, ticket_id, finding_id, conversation_id, requested_by, status, previous_ticket_status) values
  ('34000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'completed', 'fix_submitted');

set session_replication_role = origin;
