package com.moesol.cac.relay;

import java.io.IOException;
import java.net.BindException;
import java.net.Inet4Address;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.UnknownHostException;
import java.util.logging.Level;
import java.util.logging.Logger;

import javax.net.ssl.SSLSocketFactory;

import com.moesol.cac.relay.BiDirectionalRelay.SocketSupplier;

/**
 * A java based port forwarder.
 * It binds to a local bindHost:bindPort and forwards
 * to the target targetHost:targetPort.
 * <p>
 * The target connection is ALWAYS SSL/TLS.
 */
public class ServerRelay {
	private static final Logger LOGGER = Logger.getLogger(ServerRelay.class.getName());

	private final String bindHost;
	private final int bindPort;
	private final String targetHost;
	private final int targetPort;

	public ServerRelay(String bindHost, int bindPort, String targetHost, int targetPort) {
		this.bindHost = bindHost;
		this.bindPort = bindPort;
		this.targetHost = targetHost;
		this.targetPort = targetPort;
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
				relayTo(clientSocket);
			}
		} finally {
			listener.close();
		}
	}

	private void relayTo(Socket clientSocket) throws UnknownHostException, IOException {
		SocketSupplier reconnect = () -> SSLSocketFactory.getDefault().createSocket(this.targetHost, this.targetPort);
		new BiDirectionalRelay(clientSocket, reconnect.get(), reconnect);
	}

}
