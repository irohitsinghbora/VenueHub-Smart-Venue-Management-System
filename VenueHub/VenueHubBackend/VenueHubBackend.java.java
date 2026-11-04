import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.*;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class VenueHubBackend {
    // Change these three values to match your successful OracleConnectionTest.
    private static final String DB_URL = "jdbc:oracle:thin:@localhost:1521/XEPDB1";
    private static final String DB_USER = "YOUR_USERNAME";
    private static final String DB_PASSWORD = "YOUR_PASSWORD";

    public static void main(String[] args) throws Exception {
        // Check Oracle before starting the HTTP server.
        try (Connection ignored = db()) {
            System.out.println("Oracle database connected successfully.");
        }

        HttpServer server = HttpServer.create(new InetSocketAddress(8080), 0);
        server.createContext("/api", VenueHubBackend::handle);
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
        System.out.println("VenueHub backend is running at http://localhost:8080");
        System.out.println("Database: Oracle (VH_USERS, VH_VENUES, VH_BOOKINGS)");
    }

    private static Connection db() throws SQLException {
        return DriverManager.getConnection(DB_URL, DB_USER, DB_PASSWORD);
    }

    private static void handle(HttpExchange ex) throws IOException {
        addCors(ex);
        if ("OPTIONS".equalsIgnoreCase(ex.getRequestMethod())) {
            ex.sendResponseHeaders(204, -1);
            return;
        }

        String method = ex.getRequestMethod().toUpperCase(Locale.ROOT);
        String path = ex.getRequestURI().getPath();
        Map<String, String> query = parseQuery(ex.getRequestURI().getRawQuery());
        Map<String, String> body = readJson(ex);
        Object response;
        int status = 200;

        try (Connection con = db()) {
            if (path.equals("/api") || path.equals("/api/")) {
                response = Map.of("message", "VenueHub API is running with Oracle.");
            } else if (path.equals("/api/venues") && method.equals("GET")) {
                response = listVenues(con, query.getOrDefault("search", ""));
            } else if (path.matches("/api/venues/\\d+") && method.equals("GET")) {
                Map<String, Object> venue = getVenue(con, intValue(path.substring(path.lastIndexOf('/') + 1), -1));
                if (venue == null) { status = 404; response = error("Venue not found."); }
                else response = venue;
            } else if (path.equals("/api/venues") && method.equals("POST")) {
                String name = body.getOrDefault("name", "").trim();
                String location = body.getOrDefault("location", "").trim();
                String description = body.getOrDefault("description", "").trim();
                int capacity = intValue(body.get("capacity"), 0);
                double price = doubleValue(body.get("pricePerSlot"), 0);
                if (name.isEmpty() || location.isEmpty() || capacity < 1 || price < 0) {
                    status = 400;
                    response = error("Provide name, location, positive capacity and valid pricePerSlot.");
                } else {
                    response = insertVenue(con, name, location, capacity, price, description);
                    status = 201;
                }
            } else if (path.equals("/api/auth/register") && method.equals("POST")) {
                String name = body.getOrDefault("name", "").trim();
                String email = body.getOrDefault("email", "").trim().toLowerCase(Locale.ROOT);
                String password = body.getOrDefault("password", "");
                if (name.isEmpty() || email.isEmpty() || password.isEmpty()) {
                    status = 400; response = error("Please provide name, email and password.");
                } else if (userByEmail(con, email, false) != null) {
                    status = 409; response = error("An account with this email already exists.");
                } else {
                    String passwordHash = hashPassword(password);
                    try (PreparedStatement ps = con.prepareStatement(
                            "INSERT INTO VH_USERS (FULL_NAME, EMAIL, PASSWORD) VALUES (?, ?, ?)")) {
                        ps.setString(1, name);
                        ps.setString(2, email);
                        ps.setString(3, passwordHash);
                        ps.executeUpdate();
                    }
                    response = userByEmail(con, email, true);
                    status = 201;
                }
            } else if (path.equals("/api/auth/login") && method.equals("POST")) {
                String email = body.getOrDefault("email", "").trim().toLowerCase(Locale.ROOT);
                String password = body.getOrDefault("password", "");
                Map<String, Object> user = userByEmail(con, email, false);
                if (user == null || !verifyPassword(password, String.valueOf(user.get("_password")))) {
                    status = 401; response = error("Invalid email or password.");
                } else {
                    user.remove("_password");
                    response = user;
                }
            } else if (path.equals("/api/availability") && method.equals("GET")) {
                int venueId = intValue(query.get("venueId"), -1);
                String date = query.getOrDefault("date", "");
                String slot = query.getOrDefault("slot", "");
                if (getVenue(con, venueId) == null) {
                    status = 404; response = error("Venue not found.");
                } else {
                    boolean available = !isSlotBooked(con, venueId, date, slot);
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("venueId", venueId);
                    result.put("date", date);
                    result.put("slot", slot);
                    result.put("available", available);
                    response = result;
                }
            } else if (path.equals("/api/bookings") && method.equals("GET")) {
                response = listBookings(con, query.get("userId"));
            } else if (path.equals("/api/bookings") && method.equals("POST")) {
                int userId = intValue(body.get("userId"), -1);
                int venueId = intValue(body.get("venueId"), -1);
                String eventName = body.getOrDefault("eventName", "").trim();
                String date = body.getOrDefault("bookingDate", "").trim();
                String slot = body.getOrDefault("timeSlot", "").trim();
                int guests = intValue(body.get("guests"), 0);
                Map<String, Object> venue = getVenue(con, venueId);

                if (!userExists(con, userId) || venue == null || eventName.isEmpty()
                        || date.isEmpty() || slot.isEmpty() || guests < 1) {
                    status = 400;
                    response = error("Provide valid userId, venueId, eventName, bookingDate, timeSlot and guests. Log in first.");
                } else if (guests > intValue(String.valueOf(venue.get("capacity")), 0)) {
                    status = 400; response = error("Guest count exceeds venue capacity.");
                } else if (date.compareTo(LocalDate.now().toString()) < 0) {
                    status = 400; response = error("Booking date cannot be in the past.");
                } else if (isSlotBooked(con, venueId, date, slot)) {
                    status = 409; response = error("This venue is already booked for that date and time slot.");
                } else {
                    int bookingId;
                    String sql = "INSERT INTO VH_BOOKINGS (USER_ID, VENUE_ID, BOOKING_DATE, STATUS, EVENT_NAME, TIME_SLOT, GUESTS) "
                            + "VALUES (?, ?, TO_DATE(?, 'YYYY-MM-DD'), 'CONFIRMED', ?, ?, ?)";
                    try (PreparedStatement ps = con.prepareStatement(sql, new String[]{"BOOKING_ID"})) {
                        ps.setInt(1, userId);
                        ps.setInt(2, venueId);
                        ps.setString(3, date);
                        ps.setString(4, eventName);
                        ps.setString(5, slot);
                        ps.setInt(6, guests);
                        ps.executeUpdate();
                        try (ResultSet keys = ps.getGeneratedKeys()) {
                            if (!keys.next()) throw new SQLException("Could not retrieve the new booking ID.");
                            bookingId = keys.getInt(1);
                        }
                    }
                    response = getBooking(con, bookingId);
                    status = 201;
                }
            } else if (path.matches("/api/bookings/\\d+/cancel") && method.equals("PATCH")) {
                String[] parts = path.split("/");
                int bookingId = intValue(parts[3], -1);
                int userId = intValue(query.get("userId"), -1);
                Map<String, Object> booking = getBooking(con, bookingId);
                if (booking == null) {
                    status = 404; response = error("Booking not found.");
                } else if (intValue(String.valueOf(booking.get("userId")), -2) != userId) {
                    status = 403; response = error("This booking belongs to another user.");
                } else {
                    try (PreparedStatement ps = con.prepareStatement(
                            "UPDATE VH_BOOKINGS SET STATUS='CANCELLED' WHERE BOOKING_ID=? AND USER_ID=?")) {
                        ps.setInt(1, bookingId);
                        ps.setInt(2, userId);
                        ps.executeUpdate();
                    }
                    response = getBooking(con, bookingId);
                }
            } else {
                status = 404;
                response = error("Endpoint not found.");
            }
        } catch (Exception e) {
            status = 500;
            response = error("Server error: " + e.getMessage());
            e.printStackTrace();
        }

        sendJson(ex, status, toJson(response));
    }

    private static List<Map<String, Object>> listVenues(Connection con, String search) throws SQLException {
        List<Map<String, Object>> result = new ArrayList<>();
        String sql = "SELECT VENUE_ID, VENUE_NAME, LOCATION, CAPACITY, PRICE, DESCRIPTION FROM VH_VENUES "
                + "WHERE LOWER(VENUE_NAME) LIKE ? OR LOWER(NVL(LOCATION,'')) LIKE ? OR LOWER(NVL(DESCRIPTION,'')) LIKE ? "
                + "ORDER BY VENUE_ID";
        String term = "%" + search.toLowerCase(Locale.ROOT) + "%";
        try (PreparedStatement ps = con.prepareStatement(sql)) {
            ps.setString(1, term); ps.setString(2, term); ps.setString(3, term);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) result.add(venueMap(rs));
            }
        }
        return result;
        
    }

    private static Map<String, Object> getVenue(Connection con, int id) throws SQLException {
        try (PreparedStatement ps = con.prepareStatement(
                "SELECT VENUE_ID, VENUE_NAME, LOCATION, CAPACITY, PRICE, DESCRIPTION FROM VH_VENUES WHERE VENUE_ID=?")) {
            ps.setInt(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? venueMap(rs) : null;
            }
        }
    }

    private static Map<String, Object> venueMap(ResultSet rs) throws SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        int id = rs.getInt("VENUE_ID");
        String name = rs.getString("VENUE_NAME");
        double price = rs.getDouble("PRICE");
        m.put("id", id); m.put("name", name); m.put("venue_name", name);
        m.put("location", rs.getString("LOCATION"));
        m.put("capacity", rs.getInt("CAPACITY"));
        m.put("price_per_slot", price); m.put("pricePerSlot", price);
        m.put("description", rs.getString("DESCRIPTION"));
        return m;
    }

    private static Map<String, Object> insertVenue(Connection con, String name, String location,
                                                    int capacity, double price, String description) throws SQLException {
        String sql = "INSERT INTO VH_VENUES (VENUE_NAME, LOCATION, CAPACITY, PRICE, DESCRIPTION) VALUES (?, ?, ?, ?, ?)";
        int id;
        try (PreparedStatement ps = con.prepareStatement(sql, new String[]{"VENUE_ID"})) {
            ps.setString(1, name); ps.setString(2, location); ps.setInt(3, capacity);
            ps.setDouble(4, price); ps.setString(5, description);
            ps.executeUpdate();
            try (ResultSet keys = ps.getGeneratedKeys()) {
                if (!keys.next()) throw new SQLException("Could not retrieve the new venue ID.");
                id = keys.getInt(1);
            }
        }
        return getVenue(con, id);
    }

    private static Map<String, Object> userByEmail(Connection con, String email, boolean publicOnly) throws SQLException {
        try (PreparedStatement ps = con.prepareStatement(
                "SELECT USER_ID, FULL_NAME, EMAIL, PASSWORD FROM VH_USERS WHERE LOWER(EMAIL)=?")) {
            ps.setString(1, email.toLowerCase(Locale.ROOT));
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                Map<String, Object> user = new LinkedHashMap<>();
                user.put("id", rs.getInt("USER_ID"));
                user.put("name", rs.getString("FULL_NAME"));
                user.put("email", rs.getString("EMAIL"));
                if (!publicOnly) user.put("_password", rs.getString("PASSWORD"));
                return user;
            }
        }
    }

    private static boolean userExists(Connection con, int id) throws SQLException {
        try (PreparedStatement ps = con.prepareStatement("SELECT 1 FROM VH_USERS WHERE USER_ID=?")) {
            ps.setInt(1, id);
            try (ResultSet rs = ps.executeQuery()) { return rs.next(); }
        }
    }

    private static boolean isSlotBooked(Connection con, int venueId, String date, String slot) throws SQLException {
        String sql = "SELECT 1 FROM VH_BOOKINGS WHERE VENUE_ID=? AND BOOKING_DATE=TO_DATE(?, 'YYYY-MM-DD') "
                + "AND TIME_SLOT=? AND STATUS='CONFIRMED'";
        try (PreparedStatement ps = con.prepareStatement(sql)) {
            ps.setInt(1, venueId); ps.setString(2, date); ps.setString(3, slot);
            try (ResultSet rs = ps.executeQuery()) { return rs.next(); }
        }
    }

    private static List<Map<String, Object>> listBookings(Connection con, String userId) throws SQLException {
        List<Map<String, Object>> result = new ArrayList<>();
        String sql = "SELECT BOOKING_ID FROM VH_BOOKINGS "
                + (userId == null ? "" : "WHERE USER_ID=? ") + "ORDER BY BOOKING_ID DESC";
        try (PreparedStatement ps = con.prepareStatement(sql)) {
            if (userId != null) ps.setInt(1, intValue(userId, -1));
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> b = getBooking(con, rs.getInt(1));
                    if (b != null) result.add(b);
                }
            }
        }
        return result;
    }

    
    private static Map<String, Object> getBooking(Connection con, int id) throws SQLException {
        String sql = "SELECT b.BOOKING_ID, b.USER_ID, b.VENUE_ID, b.BOOKING_DATE, b.STATUS, "
                + "b.EVENT_NAME, b.TIME_SLOT, b.GUESTS, v.VENUE_NAME, v.LOCATION, v.PRICE "
                + "FROM VH_BOOKINGS b JOIN VH_VENUES v ON v.VENUE_ID=b.VENUE_ID WHERE b.BOOKING_ID=?";
        try (PreparedStatement ps = con.prepareStatement(sql)) {
            ps.setInt(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                String date = rs.getDate("BOOKING_DATE").toLocalDate().toString();
                Map<String, Object> b = new LinkedHashMap<>();
                b.put("id", rs.getInt("BOOKING_ID"));
                b.put("userId", rs.getInt("USER_ID"));
                b.put("venueId", rs.getInt("VENUE_ID"));
                b.put("venue_name", rs.getString("VENUE_NAME"));
                b.put("eventName", rs.getString("EVENT_NAME"));
                b.put("event_name", rs.getString("EVENT_NAME"));
                b.put("booking_date", date); b.put("bookingDate", date);
                b.put("timeSlot", rs.getString("TIME_SLOT")); b.put("time_slot", rs.getString("TIME_SLOT"));
                b.put("guests", rs.getInt("GUESTS"));
                b.put("price_per_slot", rs.getDouble("PRICE"));
                b.put("location", rs.getString("LOCATION"));
                b.put("status", rs.getString("STATUS"));
                return b;
            }
        }
    }

    // PBKDF2 password hashing: passwords are not stored as plain text.
    private static String hashPassword(String password) throws Exception {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        byte[] hash = pbkdf2(password, salt);
        return Base64.getEncoder().encodeToString(salt) + ":" + Base64.getEncoder().encodeToString(hash);
    }

    private static boolean verifyPassword(String password, String stored) throws Exception {
        String[] parts = stored.split(":", 2);
        if (parts.length != 2) return false;
        byte[] salt = Base64.getDecoder().decode(parts[0]);
        byte[] expected = Base64.getDecoder().decode(parts[1]);
        return MessageDigest.isEqual(expected, pbkdf2(password, salt));
    }

    private static byte[] pbkdf2(String password, byte[] salt) throws Exception {
        javax.crypto.spec.PBEKeySpec spec = new javax.crypto.spec.PBEKeySpec(
                password.toCharArray(), salt, 120000, 256);
        try {
            return javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                    .generateSecret(spec).getEncoded();
        } finally {
            spec.clearPassword();
        }
    }

    private static Map<String, Object> error(String message) {
        return Map.of("error", message);
    }

    private static Map<String, String> readJson(HttpExchange ex) throws IOException {
        String method = ex.getRequestMethod().toUpperCase(Locale.ROOT);
        if (!(method.equals("POST") || method.equals("PUT") || method.equals("PATCH"))) return new HashMap<>();
        String raw = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        Map<String, String> map = new HashMap<>();
        Pattern p = Pattern.compile("\"([^\"]+)\"\\s*:\\s*(\"((?:\\\\.|[^\"])*)\"|[-+]?\\d+(?:\\.\\d+)?|true|false|null)");
        Matcher m = p.matcher(raw);
        while (m.find()) {
            String value = m.group(3) != null ? unescape(m.group(3)) : m.group(2);
            map.put(m.group(1), "null".equals(value) ? "" : value);
        }
        return map;
    }

    private static String unescape(String s) {
        return s.replace("\\\"", "\"").replace("\\n", "\n")
                .replace("\\r", "\r").replace("\\\\", "\\");
    }

    private static Map<String, String> parseQuery(String raw) {
        Map<String, String> result = new HashMap<>();
        if (raw == null || raw.isEmpty()) return result;
        for (String pair : raw.split("&")) {
            String[] kv = pair.split("=", 2);
            result.put(decode(kv[0]), kv.length > 1 ? decode(kv[1]) : "");
        }
        return result;
    }

    private static String decode(String s) {
        try { return java.net.URLDecoder.decode(s, StandardCharsets.UTF_8); }
        catch (Exception e) { return s; }
    }

    private static int intValue(String value, int fallback) {
        try { return Integer.parseInt(value); } catch (Exception e) { return fallback; }
    }

    private static double doubleValue(String value, double fallback) {
        try { return Double.parseDouble(value); } catch (Exception e) { return fallback; }
    }

    private static void addCors(HttpExchange ex) {
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
        ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type, Authorization");
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
    }

    private static void sendJson(HttpExchange ex, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(bytes); }
    }

    private static String toJson(Object value) {
        if (value == null) return "null";
        if (value instanceof String) return "\"" + escapeJson((String) value) + "\"";
        if (value instanceof Number || value instanceof Boolean) return value.toString();
        if (value instanceof Map<?, ?> map) {
            StringJoiner joiner = new StringJoiner(",", "{", "}");
            for (Map.Entry<?, ?> entry : map.entrySet())
                joiner.add(toJson(String.valueOf(entry.getKey())) + ":" + toJson(entry.getValue()));
            return joiner.toString();
        }
        if (value instanceof Iterable<?> items) {
            StringJoiner joiner = new StringJoiner(",", "[", "]");
            for (Object item : items) joiner.add(toJson(item));
            return joiner.toString();
        }
        return toJson(String.valueOf(value));
    }

    private static String escapeJson(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
    }
}
