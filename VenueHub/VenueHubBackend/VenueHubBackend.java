import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class VenueHubBackend {
    private static final List<Map<String, Object>> users = new ArrayList<>();
    private static final List<Map<String, Object>> venues = new ArrayList<>();
    private static final List<Map<String, Object>> bookings = new ArrayList<>();
    private static final AtomicInteger userIds = new AtomicInteger(1);
    private static final AtomicInteger venueIds = new AtomicInteger(1);
    private static final AtomicInteger bookingIds = new AtomicInteger(1);

    public static void main(String[] args) throws Exception {
        seedVenues();
        HttpServer server = HttpServer.create(new InetSocketAddress(8081), 0);
        server.createContext("/api", VenueHubBackend::handle);
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
        System.out.println("VenueHub backend is running at http://localhost:8081");
        System.out.println("Demo mode: data is stored in memory and resets when the server stops.");
    }

    private static void seedVenues() {
        addVenue("Grand Celebration Hall", "Dehradun", 500, 12000,
                "Spacious hall for weddings, receptions and large events.");
        addVenue("City Conference Centre", "Dehradun", 200, 7000,
                "A practical venue for meetings, seminars and conferences.");
        addVenue("Garden Party Lawn", "Dehradun", 350, 9000,
                "Open-air lawn for family functions and celebrations.");
    }

    private static synchronized void handle(HttpExchange ex) throws IOException {
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

        try {
            if (path.equals("/api/auth/register") && method.equals("POST")) {
                String name = body.getOrDefault("name", "").trim();
                String email = body.getOrDefault("email", "").trim().toLowerCase(Locale.ROOT);
                String password = body.getOrDefault("password", "");
                if (name.isEmpty() || email.isEmpty() || password.isEmpty()) {
                    status = 400;
                    response = error("Please provide name, email and password.");
                } else if (findUserByEmail(email) != null) {
                    status = 409;
                    response = error("An account with this email already exists.");
                } else {
                    Map<String, Object> user = new LinkedHashMap<>();
                    user.put("id", userIds.getAndIncrement());
                    user.put("name", name);
                    user.put("email", email);
                    user.put("password", password);
                    users.add(user);
                    response = publicUser(user);
                }
            } else if (path.equals("/api/auth/login") && method.equals("POST")) {
                String email = body.getOrDefault("email", "").trim().toLowerCase(Locale.ROOT);
                String password = body.getOrDefault("password", "");
                Map<String, Object> user = findUserByEmail(email);
                if (user == null || !password.equals(user.get("password"))) {
                    status = 401;
                    response = error("Invalid email or password.");
                } else {
                    response = publicUser(user);
                }
            } else if (path.equals("/api/venues") && method.equals("GET")) {
                String search = query.getOrDefault("search", "").toLowerCase(Locale.ROOT);
                List<Map<String, Object>> result = new ArrayList<>();
                for (Map<String, Object> venue : venues) {
                    String text = (venue.get("name") + " " + venue.get("location") + " " + venue.get("description")).toLowerCase(Locale.ROOT);
                    if (search.isEmpty() || text.contains(search)) result.add(venue);
                }
                response = result;
            } else if (path.equals("/api/venues") && method.equals("POST")) {
                String name = body.getOrDefault("name", "").trim();
                String location = body.getOrDefault("location", "").trim();
                int capacity = integer(body.get("capacity"), 0);
                double price = decimal(body.get("pricePerSlot"), 0);
                String description = body.getOrDefault("description", "").trim();
                if (name.isEmpty() || location.isEmpty() || capacity < 1 || price < 0) {
                    status = 400;
                    response = error("Provide name, location, a positive capacity and a valid pricePerSlot.");
                } else {
                    response = addVenue(name, location, capacity, price, description);
                }
            } else if (path.matches("/api/venues/\\d+") && method.equals("GET")) {
                int id = Integer.parseInt(path.substring(path.lastIndexOf('/') + 1));
                Map<String, Object> venue = findVenue(id);
                if (venue == null) { status = 404; response = error("Venue not found."); }
                else response = venue;
            } else if (path.equals("/api/availability") && method.equals("GET")) {
                int venueId = integer(query.get("venueId"), -1);
                String date = query.getOrDefault("date", "");
                String slot = query.getOrDefault("slot", "");
                if (findVenue(venueId) == null) {
                    status = 404;
                    response = error("Venue not found.");
                } else {
                    boolean available = true;
                    for (Map<String, Object> booking : bookings) {
                        if ("BOOKED".equals(booking.get("status"))
                                && String.valueOf(booking.get("venueId")).equals(String.valueOf(venueId))
                                && date.equals(booking.get("bookingDate"))
                                && slot.equals(booking.get("timeSlot"))) {
                            available = false;
                            break;
                        }
                    }
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("venueId", venueId);
                    result.put("date", date);
                    result.put("slot", slot);
                    result.put("available", available);
                    response = result;
                }
            } else if (path.equals("/api/bookings") && method.equals("GET")) {
                String userId = query.get("userId");
                List<Map<String, Object>> result = new ArrayList<>();
                for (Map<String, Object> booking : bookings) {
                    if (userId == null || userId.equals(String.valueOf(booking.get("userId")))) {
                        result.add(booking);
                    }
                }
                response = result;
            } else if (path.equals("/api/bookings") && method.equals("POST")) {
                int userId = integer(body.get("userId"), -1);
                int venueId = integer(body.get("venueId"), -1);
                String eventName = body.getOrDefault("eventName", "").trim();
                String date = body.getOrDefault("bookingDate", "").trim();
                String slot = body.getOrDefault("timeSlot", "").trim();
                int guests = integer(body.get("guests"), 0);
                Map<String, Object> venue = findVenue(venueId);
                if (findUser(userId) == null || venue == null || eventName.isEmpty() || date.isEmpty() || slot.isEmpty() || guests < 1) {
                    status = 400;
                    response = error("Provide a valid userId, venueId, eventName, bookingDate, timeSlot and guests. Register or log in first.");
                } else if (guests > integer(String.valueOf(venue.get("capacity")), 0)) {
                    status = 400;
                    response = error("Guest count exceeds venue capacity.");
                } else if (date.compareTo(LocalDate.now().toString()) < 0) {
                    status = 400;
                    response = error("Booking date cannot be in the past.");
                } else if (isSlotBooked(venueId, date, slot)) {
                    status = 409;
                    response = error("This venue is already booked for that date and time slot.");
                } else {
                    Map<String, Object> booking = new LinkedHashMap<>();
                    booking.put("id", bookingIds.getAndIncrement());
                    booking.put("userId", userId);
                    booking.put("venueId", venueId);
                    booking.put("venue_name", venue.get("name"));
                    booking.put("eventName", eventName);
                    booking.put("booking_date", date);
                    booking.put("bookingDate", date);
                    booking.put("timeSlot", slot);
                    booking.put("guests", guests);
                    booking.put("price_per_slot", venue.get("price_per_slot"));
                    booking.put("status", "BOOKED");
                    bookings.add(booking);
                    response = booking;
                    status = 201;
                }
            } else if (path.matches("/api/bookings/\\d+/cancel") && method.equals("PATCH")) {
                String[] parts = path.split("/");
                int id = Integer.parseInt(parts[3]);
                String userId = query.get("userId");
                Map<String, Object> booking = findBooking(id);
                if (booking == null) {
                    status = 404;
                    response = error("Booking not found.");
                } else if (userId != null && !userId.equals(String.valueOf(booking.get("userId")))) {
                    status = 403;
                    response = error("This booking belongs to another user.");
                } else {
                    booking.put("status", "CANCELLED");
                    response = booking;
                }
            } else if (path.equals("/api") || path.equals("/api/")) {
                response = Map.of("message", "VenueHub API is running.");
            } else {
                status = 404;
                response = error("Endpoint not found.");
            }
        } catch (Exception e) {
            status = 500;
            response = error("Server error: " + e.getMessage());
        }

        sendJson(ex, status, toJson(response));
    }

    private static Map<String, Object> addVenue(String name, String location, int capacity, double price, String description) {
        Map<String, Object> venue = new LinkedHashMap<>();
        int id = venueIds.getAndIncrement();
        venue.put("id", id);
        venue.put("name", name);
        venue.put("venue_name", name);
        venue.put("location", location);
        venue.put("capacity", capacity);
        venue.put("price_per_slot", price);
        venue.put("pricePerSlot", price);
        venue.put("description", description);
        venues.add(venue);
        return venue;
    }

    private static Map<String, Object> findUserByEmail(String email) {
        for (Map<String, Object> user : users) if (email.equals(user.get("email"))) return user;
        return null;
    }

    private static Map<String, Object> findUser(int id) {
        for (Map<String, Object> user : users) if (String.valueOf(user.get("id")).equals(String.valueOf(id))) return user;
        return null;
    }

    private static Map<String, Object> findVenue(int id) {
        for (Map<String, Object> venue : venues) if (String.valueOf(venue.get("id")).equals(String.valueOf(id))) return venue;
        return null;
    }

    private static Map<String, Object> findBooking(int id) {
        for (Map<String, Object> booking : bookings) if (String.valueOf(booking.get("id")).equals(String.valueOf(id))) return booking;
        return null;
    }

    private static boolean isSlotBooked(int venueId, String date, String slot) {
        for (Map<String, Object> b : bookings) {
            if ("BOOKED".equals(b.get("status"))
                    && String.valueOf(b.get("venueId")).equals(String.valueOf(venueId))
                    && date.equals(b.get("bookingDate")) && slot.equals(b.get("timeSlot"))) return true;
        }
        return false;
    }

    private static Map<String, Object> publicUser(Map<String, Object> user) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", user.get("id"));
        result.put("name", user.get("name"));
        result.put("email", user.get("email"));
        return result;
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
        return s.replace("\\\"", "\"").replace("\\n", "\n").replace("\\r", "\r").replace("\\\\", "\\");
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

    private static int integer(String value, int fallback) {
        try { return Integer.parseInt(value); } catch (Exception e) { return fallback; }
    }

    private static double decimal(String value, double fallback) {
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
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                joiner.add(toJson(String.valueOf(entry.getKey())) + ":" + toJson(entry.getValue()));
            }
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
