package com.moesol.cac.relay;

import static org.junit.Assert.*;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;

import org.junit.Test;

public class Socks5AddressingTest {

    @Test
    public void testIP_V4() throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();

        InetAddress addr = Inet4Address.getByName("127.0.0.1");
        Socks5Addressing.writeAddress(new DataOutputStream(baos), addr);

        byte[] bytes = baos.toByteArray();
        assertEquals(5, bytes.length);

        ByteArrayInputStream bais = new ByteArrayInputStream(bytes);
        InetAddress back = Socks5Addressing.readAddress(new DataInputStream(bais));
        assertEquals(addr, back);
    }

    @Test
    public void testIP_V6() throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();

        InetAddress addr = Inet6Address.getByName("[2001:0db8:85a3:0000:0000:8a2e:0370:7334]");
        Socks5Addressing.writeAddress(new DataOutputStream(baos), addr);

        byte[] bytes = baos.toByteArray();
        assertEquals(17, bytes.length);

        ByteArrayInputStream bais = new ByteArrayInputStream(bytes);
        InetAddress back = Socks5Addressing.readAddress(new DataInputStream(bais));
        assertEquals(addr, back);
    }

    @Test
    public void testFQDN() throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();

        Socks5Addressing.writeAddress(new DataOutputStream(baos), "www.moesol.com");

        byte[] bytes = baos.toByteArray();
        assertEquals(16, bytes.length);

        ByteArrayInputStream bais = new ByteArrayInputStream(bytes);
        InetAddress back = Socks5Addressing.readAddress(new DataInputStream(bais));
        assertEquals("www.moesol.com", back.getHostName());
    }
}
