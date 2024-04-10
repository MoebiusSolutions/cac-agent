package com.moesol.cac.relay;

import static com.moesol.cac.relay.Socks5Protocol.java8readNBytes;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.BindException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.UnknownHostException;
import java.util.logging.Level;
import java.util.logging.Logger;

import javax.net.ssl.SSLSocketFactory;

import com.moesol.cac.relay.BiDirectionalRelay.SocketSupplier;

/**
 * A java based socks5 proxy.
 * It binds to a local bindHost:bindPort and acts as a socks5 proxy
 * <p>
 * The target connection is ALWAYS SSL/TLS.
 */
public class Socks5Proxy {
	private static final Logger LOGGER = Logger.getLogger(Socks5Proxy.class.getName());

	private final String bindHost;
	private final int bindPort;

	public Socks5Proxy(String bindHost, int bindPort) {
		this.bindHost = bindHost;
		this.bindPort = bindPort;
	}

	public void run() {
		try {
			run0();
		} catch (BindException e) {
			LOGGER.log(Level.WARNING, "Unable to bind to {0}", this.bindHost + ":" + this.bindPort);
		} catch (IOException e) {
			throw new RuntimeException(e);
		}
	}
	public void run0() throws UnknownHostException, IOException {
		ServerSocket listener = new ServerSocket(this.bindPort, 0, Inet4Address.getByName(this.bindHost));
		try {
			while (true) {
				Socket clientSocket = listener.accept();
				DataInputStream in = new DataInputStream(clientSocket.getInputStream());
				DataOutputStream out = new DataOutputStream(clientSocket.getOutputStream());
				try {
					handshake(in, out);
					handleRequest(in, out, clientSocket);
				} catch (IOException e) {
					LOGGER.log(Level.WARNING, "Connection failure", e);
					close(in, out, clientSocket);
				} catch (Exception e) {
					LOGGER.log(Level.WARNING, "Unknown connection failure", e);
					close(in, out, clientSocket);
				}
			}
		} finally {
			listener.close();
		}
	}

	private void close(DataInputStream in, DataOutputStream out, Socket clientSocket) throws IOException {
		in.close();
		out.close();
		clientSocket.close();
	}

	private void handshake(DataInputStream in, DataOutputStream out) throws IOException {
		byte nmethods = Socks5Protocol.readMethods(in);
		byte[] methods = java8readNBytes(in, nmethods);

		// Check for NO AUTHENTICATION REQUIRED
		boolean foundNoAuth = false;
		for (int i = 0; i < methods.length; i++) {
			if (methods[i] == Socks5Protocol.NO_AUTHENTICATION_REQUIRED) {
				foundNoAuth = true;
			}
		}
		if (foundNoAuth) {
			Socks5Protocol.writeSelectedMethod(out, Socks5Protocol.NO_AUTHENTICATION_REQUIRED);
		} else {
			Socks5Protocol.writeSelectedMethod(out, Socks5Protocol.NO_ACCEPTABLE_METHODS);
			throw new IllegalArgumentException("Missing NO AUTH");
		}
	}

	private void handleRequest(DataInputStream in, DataOutputStream out, Socket clientSocket) throws UnknownHostException, IOException {
		byte cmd = Socks5Protocol.readRequest(in);
		if (cmd != Socks5Protocol.CONNECT) {
			Socks5Protocol.writeReply(out, Socks5Protocol.COMMAND_NOT_SUPPORTED);
			throw new UnsupportedOperationException("Only CMD CONNECT(0x01) is supported");
		}

		InetAddress dstAddr = Socks5Addressing.readAddress(in);
		int dstPort = Socks5Addressing.readPort(in);

		SocketSupplier reconnect = () -> SSLSocketFactory.getDefault().createSocket(dstAddr, dstPort);
		Socket dstSocket = reconnect.get();

		Socks5Protocol.writeReply(out, Socks5Protocol.SUCCEEDED);
		Socks5Addressing.writeAddress(out, dstSocket.getLocalAddress());
		Socks5Addressing.writePort(out, dstSocket.getLocalPort());
		out.flush();

		new BiDirectionalRelay(clientSocket, reconnect.get(), reconnect);
	}
}
