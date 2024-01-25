package com.moesol.cac.relay;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;

public class Socks5Protocol {
	// From https://datatracker.ietf.org/doc/html/rfc1928
	private static final int VER = 0;
	private static final byte SOCKS5 = 0x05;

	private static final int NMETHODS = 1;
	public static final byte NO_AUTHENTICATION_REQUIRED = 0x00;
	public static final byte NO_ACCEPTABLE_METHODS = (byte) 0xFF;

	private static final int CMD = 1;
    public static final byte CONNECT = 0x01;

	private static final int REP = 1;

	private static final int RSV = 2;
	private static final byte RESERVED = 0x00;

	public static final byte SUCCEEDED = 0x00;
	public static final byte COMMAND_NOT_SUPPORTED = 0x07;

    /**
	 * @param in
	 * @return number of methods
	 * @throws IOException
	 */
	public static byte readMethods(DataInputStream in) throws IOException {
		byte[] request = new byte[2];
		in.readFully(request);
		if (request[VER] != 0x5) {
			throw new IllegalArgumentException("Version is not 0x05");
		}
		return request[NMETHODS];
	}

	public static void writeSelectedMethod(DataOutputStream out, byte method) throws IOException {
		out.write(new byte[]{ SOCKS5, method });
	}

	public static byte readRequest(DataInputStream in) throws IOException {
		byte[] request = new byte[3];
		in.readFully(request);
		if (request[VER] != 0x5) {
			throw new IllegalArgumentException("Version is not 0x05");
		}
		if (request[RSV] != RESERVED) {
			throw new IllegalArgumentException("RSV is not 0x00");
		}
		return request[CMD];
	}

	public static void writeReply(DataOutputStream out, byte reply) throws IOException {
		byte[] bytes = new byte[3];
		bytes[VER] = SOCKS5;
		bytes[REP] = reply;
		bytes[RSV] = RESERVED;
		out.write(bytes);
	}

}
