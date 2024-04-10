package com.moesol.cac.relay;

import static com.moesol.cac.relay.Socks5Protocol.loggedWrite;
import static com.moesol.cac.relay.Socks5Protocol.java8readNBytes;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Read and write addresses on the wire (Data{Input/Output}Stream)
 */
public class Socks5Addressing {
	private static final Logger LOGGER = Logger.getLogger(Socks5Addressing.class.getName());

    private static final byte IP_V4 = 0x01;
    private static final byte FQDN = 0x03;
    private static final byte IP_V6 = 0x04;

    public static void writeAddress(DataOutputStream out, InetAddress addr) throws IOException {
        if (addr instanceof Inet4Address) {
            byte[] ip = addr.getAddress();
            loggedWrite(out, IP_V4, "ATYP:IP V4");
            loggedWrite(out, ip, "BND.ADDR");
            return;
        }
        if (addr instanceof Inet6Address) {
            byte[] ip = addr.getAddress();
            loggedWrite(out, IP_V6, "ATYP:IP V6");
            loggedWrite(out, ip, "BND.ADDR");
            return;
        }
        throw new UnsupportedOperationException("Unknown IP address type");
    }

    /* Domain type of address */
    public static void writeAddress(DataOutputStream out, String dns) throws IOException {
        byte[] fqdn = dns.getBytes(StandardCharsets.US_ASCII);
        loggedWrite(out, FQDN, "ATYP:DOMAINNAME");
        loggedWrite(out, (byte)fqdn.length, "BND.ADDR: number of octets");
        loggedWrite(out, fqdn, "BND.ADDR");
    }

	public static InetAddress readAddress(DataInputStream in) throws IOException {
        byte atyp = in.readByte();
		switch (atyp) {
		case IP_V4:
			return Inet4Address.getByAddress(java8readNBytes(in, 4));
		case FQDN:
			return InetAddress.getByName(new String(java8readNBytes(in, in.readByte())));
		case IP_V6:
			return Inet6Address.getByAddress(java8readNBytes(in, 16));
		}
		throw new UnsupportedOperationException("Unknown address type");
	}

    public static int readPort(DataInputStream in) throws IOException {
        return in.readUnsignedShort();
    }
    public static void writePort(DataOutputStream out, int port) throws IOException {
        LOGGER.log(Level.FINE, () -> String.format("port: %d", port));
        out.writeShort(port);
    }
}
