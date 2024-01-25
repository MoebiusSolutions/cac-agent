package com.moesol.cac.relay;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;

/**
 * Read and write addresses on the wire (Data{Input/Output}Stream)
 */
public class Socks5Addressing {
    private static final byte IP_V4 = 0x01;
    private static final byte FQDN = 0x03;
    private static final byte IP_V6 = 0x04;

    public static void writeAddress(DataOutputStream out, InetAddress addr) throws IOException {
        if (addr instanceof Inet4Address) {
            out.writeByte(IP_V4);
            byte[] ip = addr.getAddress();
            out.write(ip);
            return;
        }
        if (addr instanceof Inet6Address) {
            out.writeByte(IP_V6);
            byte[] ip = addr.getAddress();
            out.write(ip);
            return;
        }
        throw new UnsupportedOperationException("Unknown IP address type");
    }

    /* Domain type of address */
    public static void writeAddress(DataOutputStream out, String dns) throws IOException {
        out.writeByte(FQDN);
        byte[] fqdn = dns.getBytes(StandardCharsets.US_ASCII);
        out.writeByte(fqdn.length);
        out.write(fqdn);
    }

	public static InetAddress readAddress(DataInputStream in) throws IOException {
        byte atyp = in.readByte();
		switch (atyp) {
		case IP_V4:
			return Inet4Address.getByAddress(in.readNBytes(4));
		case FQDN:
			return InetAddress.getByName(new String(in.readNBytes(in.readByte())));
		case IP_V6:
			return Inet6Address.getByAddress(in.readNBytes(16));
		}
		throw new UnsupportedOperationException("Unknown address type");
	}

    public static int readPort(DataInputStream in) throws IOException {
        return in.readUnsignedShort();
    }
    public static void writePort(DataOutputStream out, int port) throws IOException {
        out.writeShort(port);
    }
}
