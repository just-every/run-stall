-- Customer doors find orders, carts and requests by the account's sign-in email.
-- A changed email is unproven until an email link sent to it opens a session:
-- the change revokes links sent to the old address, so only such a session
-- proves the new one. Sessions open before the change prove only the old one.
CREATE TABLE st_email_changes (operator_id TEXT PRIMARY KEY NOT NULL);
CREATE TABLE st_email_link_sessions (session_id TEXT PRIMARY KEY NOT NULL);
CREATE TRIGGER st_email_changed AFTER UPDATE OF email ON oa_operators WHEN NEW.email IS NOT OLD.email BEGIN
 INSERT OR IGNORE INTO st_email_changes(operator_id) VALUES(NEW.id);
 DELETE FROM st_email_link_sessions WHERE session_id IN (SELECT id FROM oa_sessions WHERE operator_id=NEW.id);
END;
CREATE TRIGGER st_email_link_session AFTER INSERT ON oa_sessions
 WHEN NEW.source_token_id IS NOT NULL AND EXISTS(SELECT 1 FROM st_email_changes WHERE operator_id=NEW.operator_id) BEGIN
 INSERT OR IGNORE INTO st_email_link_sessions(session_id) VALUES(NEW.id);
END;
