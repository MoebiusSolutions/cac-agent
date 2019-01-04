package com.moesol.cac.relay;

import java.io.FileInputStream;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.UnknownHostException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.NoSuchProviderException;
import java.util.logging.Level;
import java.util.logging.Logger;

import javax.net.ssl.KeyManager;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocketFactory;
import javax.net.ssl.SSLSocketFactory;

import com.moesol.cac.agent.CacHookingAgent;

/**
 * A java based port forwarder.
 * It binds to a local bindHost:bindPort and forwards
 * to the target targetHost:targetPort.
 * <p>
 * The incoming connection is SSL/TLS.
 * The target connection is ALWAYS SSL/TLS.
 */
public class SslServerRelay {
	private static final Logger LOGGER = Logger.getLogger(SslServerRelay.class.getName());
	private final String bindHost;
	private final int bindPort;
	private final String targetHost;
	private final int targetPort;

	public SslServerRelay(String bindHost, int bindPort, String targetHost, int targetPort) {
		this.bindHost = bindHost;
		this.bindPort = bindPort;
		this.targetHost = targetHost;
		this.targetPort = targetPort;
	}

	public void run() {
		try {
			run0();
		} catch (Exception e) {
			throw new RuntimeException(e);
		}
	}
	public void run0() throws Exception {
		SSLContext sslContext = SSLContext.getInstance(CacHookingAgent.CONTEXT);
		sslContext.init(getKeyManagers(), null, new java.security.SecureRandom());
		SSLServerSocketFactory ssf = sslContext.getServerSocketFactory();
	    ServerSocket sslListener = ssf.createServerSocket(this.bindPort, 0, Inet4Address.getByName(this.bindHost));
		
		try {
			while (true) {
				Socket clientSocket = sslListener.accept();
				relayTo(clientSocket);
			}
		} finally {
			sslListener.close();
		}
	}

	private void relayTo(Socket clientSocket) throws UnknownHostException, IOException {
		Socket serverSocket = SSLSocketFactory.getDefault().createSocket(this.targetHost, this.targetPort);
		new BiDirectionalRelay(clientSocket, serverSocket);
	}

	private static String keyStore() {
		String keyStore = System.getProperty("javax.net.ssl.keyStore");
		if (keyStore == null) {
			throw new IllegalStateException("Must provide key for SSL server.");
		}
		return keyStore;
	}
	private static String keyStoreType() {
		return System.getProperty("javax.net.ssl.keyStoreType", KeyStore.getDefaultType());
	}
	private static String keyStoreProvider() {
		return System.getProperty("javax.net.ssl.keyStoreProvider");
	}
	private static char[] keystorePassword() {
		return System.getProperty("javax.net.ssl.keyStorePassword", "changeit").toCharArray();
	}

	private static KeyStore keyStoreInstance() throws KeyStoreException, NoSuchProviderException {
		return keyStoreProvider() != null ?
				  KeyStore.getInstance(keyStoreType(), keyStoreProvider())
				: KeyStore.getInstance(keyStoreType());
	}
	
    private static KeyManager[] getKeyManagers() throws Exception {
        LOGGER.log(Level.CONFIG, "keyStore is : {0}", keyStore());
        LOGGER.log(Level.CONFIG, "keyStore type is : {0}", keyStoreType());
        LOGGER.log(Level.CONFIG, "keyStore provider is : {0}", keyStoreProvider());
        // Don't log the password!

        try (FileInputStream fs = new FileInputStream(keyStore())) {
        	KeyStore ks = keyStoreInstance();
        	ks.load(fs, keystorePassword());
        	
        	String defaultAlgorithm = KeyManagerFactory.getDefaultAlgorithm();
			LOGGER.log(Level.CONFIG, "Init keymanager of type {0}", defaultAlgorithm);
            KeyManagerFactory kmf = KeyManagerFactory.getInstance(defaultAlgorithm);
            kmf.init(ks, keystorePassword());
            return kmf.getKeyManagers();
        }
    }
    
}
