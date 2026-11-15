-- Drop existing tables if re-running
SET DEFINE OFF;


BEGIN
   EXECUTE IMMEDIATE 'DROP TABLE bookings CASCADE CONSTRAINTS';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/
BEGIN
   EXECUTE IMMEDIATE 'DROP TABLE venues CASCADE CONSTRAINTS';
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

CREATE TABLE venues (
    id             VARCHAR2(20)  PRIMARY KEY,
    name           VARCHAR2(150) NOT NULL,
    category       VARCHAR2(50)  NOT NULL,
    capacity       NUMBER(10)    NOT NULL,
    price_per_hour NUMBER(10)    NOT NULL,
    location       VARCHAR2(200) NOT NULL,
    image          VARCHAR2(500)
);

CREATE TABLE bookings (
    id              VARCHAR2(20)  PRIMARY KEY,
    venue_id        VARCHAR2(20)  NOT NULL,
    applicant_name  VARCHAR2(100) NOT NULL,
    applicant_email VARCHAR2(150) NOT NULL,
    event_title     VARCHAR2(200) NOT NULL,
    booking_date    DATE          NOT NULL,
    start_time      VARCHAR2(5)   NOT NULL,
    end_time        VARCHAR2(5)   NOT NULL,
    total_price     NUMBER(10)    NOT NULL,
    status          VARCHAR2(20)  DEFAULT 'Approved' NOT NULL
                    CHECK (status IN ('Pending', 'Approved', 'Cancelled')),
    created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_booking_venue FOREIGN KEY (venue_id)
        REFERENCES venues(id) ON DELETE CASCADE
);

CREATE INDEX idx_venue_date ON bookings (venue_id, booking_date);

-- Seed data
INSERT INTO venues (id, name, category, capacity, price_per_hour, location, image) VALUES
('v1','Main Campus Auditorium','Auditorium',500,2500,'Academic Block A, Ground Floor','https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=800&q=80');

INSERT INTO venues (id, name, category, capacity, price_per_hour, location, image) VALUES
('v2','Executive Seminar Hall','Conference Room',80,1200,'Management Block, 2nd Floor','https://images.unsplash.com/photo-1431540015161-0bf868a2d407?auto=format&fit=crop&w=800&q=80');

INSERT INTO venues (id, name, category, capacity, price_per_hour, location, image) VALUES
('v3','Grand Celebration Hall','Hall',350,2000,'Student Activity Center','https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=800&q=80');

INSERT INTO venues (id, name, category, capacity, price_per_hour, location, image) VALUES
('v4','Indoor Sports Complex & Court','Sports',200,800,'Sports Arena, North Gate','https://images.unsplash.com/photo-1534438327276-14e550c3a48?auto=format&fit=crop&w=800&q=80');

COMMIT;
EXIT;