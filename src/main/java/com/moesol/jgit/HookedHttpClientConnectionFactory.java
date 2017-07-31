package com.moesol.jgit;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.net.Proxy;
import java.net.URL;
import java.security.KeyManagementException;
import java.security.KeyStore;
import java.security.KeyStoreException;
import java.security.NoSuchAlgorithmException;
import java.security.cert.CertificateException;

import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;

import org.eclipse.jgit.transport.http.HttpConnection;
import org.eclipse.jgit.transport.http.apache.HttpClientConnection;
import org.eclipse.jgit.transport.http.apache.HttpClientConnectionFactory;

import com.moesol.cac.agent.selector.AbstractSelectorKeyManager;
import com.moesol.url.CacHookingAgent;
import com.moesol.url.Config;

public class HookedHttpClientConnectionFactory extends HttpClientConnectionFactory {

	@Override
	public HttpConnection create(URL url) throws IOException {
		try {
			HttpClientConnection conn = new HttpClientConnection(url.toString());
			configurKeyManager(conn);
			return conn;
		} catch (NoSuchAlgorithmException | KeyManagementException | KeyStoreException | CertificateException e) {
			throw new IOException(e);
		}
	}

	@Override
	public HttpConnection create(URL url, Proxy proxy) throws IOException {
		try {
			HttpClientConnection conn = new HttpClientConnection(url.toString(), proxy);
			configurKeyManager(conn);
			return conn;
		} catch (NoSuchAlgorithmException | KeyManagementException | KeyStoreException | CertificateException e) {
			throw new IOException(e);
		}
	}

	private void configurKeyManager(HttpClientConnection conn) throws NoSuchAlgorithmException, KeyManagementException, KeyStoreException, CertificateException, IOException {
		Config config = Config.loadFromUserHome();
		KeyManager[] kmgrs = AbstractSelectorKeyManager.makeKeyManagers(config);
		TrustManager[] tmgrs = makeTrustManagers(config);
		conn.configure(kmgrs, tmgrs, new java.security.SecureRandom());

		// And the default java ones too...
		SSLContext sslContext = SSLContext.getInstance(CacHookingAgent.CONTEXT);
		sslContext.init(kmgrs, tmgrs, new java.security.SecureRandom());
	}

	private TrustManager[] makeTrustManagers(Config config) throws NoSuchAlgorithmException, KeyStoreException, CertificateException, IOException {
		TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
		tmf.init(loadKeyStore());
		return tmf.getTrustManagers();
	}
	
	private KeyStore loadKeyStore() throws IOException, KeyStoreException, NoSuchAlgorithmException, CertificateException {
		File trustStoreFile = new File(System.getProperty("user.home"), CacHookingAgent.CAC_AGENT_DIR + "/truststore.jks");
		if (trustStoreFile.canRead()) {
			System.out.println("Reading trustore " + trustStoreFile.getPath());
		} else {
			return null;
		}
		
		try (FileInputStream trust = new FileInputStream(trustStoreFile)) {
			KeyStore r = KeyStore.getInstance(KeyStore.getDefaultType());
			r.load(trust, "password".toCharArray());
			return r;
		}
	}
	
}