package ru.local.gamespace.loader;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Small strict JSON reader for the bounded update catalog; no coercion or duplicate keys. */
final class UpdateJson {
    private final String text;
    private int position;
    private int values;

    private UpdateJson(String text) { this.text = text; }

    static Object parse(String text) throws IOException {
        UpdateJson reader = new UpdateJson(text);
        Object value = reader.value(0);
        reader.space();
        if (reader.position != text.length()) throw invalid();
        return value;
    }

    private Object value(int depth) throws IOException {
        if (depth > 16 || ++values > 10000) throw invalid();
        space();
        if (position == text.length()) throw invalid();
        char c = text.charAt(position);
        if (c == '"') return string();
        if (c == '{') {
            position++;
            Map<String, Object> result = new LinkedHashMap<String, Object>();
            space();
            if (take('}')) return result;
            do {
                space();
                String key = string();
                space();
                if (!take(':') || result.containsKey(key)) throw invalid();
                result.put(key, value(depth + 1));
                space();
                if (take('}')) return result;
            } while (take(','));
            throw invalid();
        }
        if (c == '[') {
            position++;
            List<Object> result = new ArrayList<Object>();
            space();
            if (take(']')) return result;
            do {
                result.add(value(depth + 1));
                space();
                if (take(']')) return result;
            } while (take(','));
            throw invalid();
        }
        for (String literal : new String[] {"true", "false", "null"}) {
            if (text.startsWith(literal, position)) {
                position += literal.length();
                return "null".equals(literal) ? null : Boolean.valueOf(literal);
            }
        }
        int start = position;
        take('-');
        if (!take('0')) {
            if (position == text.length() || text.charAt(position) < '1' || text.charAt(position) > '9') throw invalid();
            while (position < text.length() && digit(text.charAt(position))) position++;
        }
        if (position < text.length() && (text.charAt(position) == '.' || text.charAt(position) == 'e' || text.charAt(position) == 'E')) {
            // Catalog schema 1 has only integers. Reject lossy numeric conversions.
            throw invalid();
        }
        try { return Long.valueOf(text.substring(start, position)); }
        catch (NumberFormatException error) { throw invalid(); }
    }

    private String string() throws IOException {
        if (!take('"')) throw invalid();
        StringBuilder out = new StringBuilder();
        while (position < text.length()) {
            char c = text.charAt(position++);
            if (c == '"') {
                String value = out.toString();
                for (int i = 0; i < value.length(); i++) {
                    char ch = value.charAt(i);
                    if (Character.isHighSurrogate(ch)) {
                        if (++i >= value.length() || !Character.isLowSurrogate(value.charAt(i))) throw invalid();
                    } else if (Character.isLowSurrogate(ch)) throw invalid();
                }
                return value;
            }
            if (c < 0x20) throw invalid();
            if (c == '\\') {
                if (position == text.length()) throw invalid();
                c = text.charAt(position++);
                switch (c) {
                    case '"': case '\\': case '/': break;
                    case 'b': c = '\b'; break;
                    case 'f': c = '\f'; break;
                    case 'n': c = '\n'; break;
                    case 'r': c = '\r'; break;
                    case 't': c = '\t'; break;
                    case 'u':
                        int code = 0;
                        for (int i = 0; i < 4; i++) {
                            if (position == text.length()) throw invalid();
                            char hex = text.charAt(position++);
                            int part = "0123456789abcdef".indexOf(Character.toLowerCase(hex));
                            if (part < 0) throw invalid();
                            code = code * 16 + part;
                        }
                        c = (char) code;
                        break;
                    default: throw invalid();
                }
            }
            out.append(c);
        }
        throw invalid();
    }

    private void space() {
        while (position < text.length() && " \t\r\n".indexOf(text.charAt(position)) >= 0) position++;
    }
    private boolean take(char c) {
        if (position < text.length() && text.charAt(position) == c) { position++; return true; }
        return false;
    }
    private static boolean digit(char c) { return c >= '0' && c <= '9'; }
    static IOException invalid() { return new IOException("Не удалось прочитать список версий: некорректный каталог обновлений."); }
}
