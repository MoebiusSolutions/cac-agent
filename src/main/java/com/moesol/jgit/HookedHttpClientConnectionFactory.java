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

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.KeyManager;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;

import org.eclipse.jgit.transport.http.HttpConnection;
import org.eclipse.jgit.transport.http.apache.HttpClientConnection;
import org.eclipse.jgit.transport.http.apache.HttpClientConnectionFactory;

import com.moesol.cac.agent.Config;
import com.moesol.cac.agent.selector.AbstractSelectorKeyManager;

public class HookedHttpClientConnectionFactory extends HttpClientConnectionFactory {
	
	private final Config config;
	private KeyManager[] kmgrs;
	private TrustManager[] tmgrs;

	public HookedHttpClientConnectionFactory(Config config) {
		this.config = config;
	}

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
		if (kmgrs == null) {
			kmgrs = AbstractSelectorKeyManager.makeKeyManagers(config);
		}
		if (tmgrs == null) {
			tmgrs = makeTrustManagers(config);
		}
		conn.configure(kmgrs, tmgrs, new java.security.SecureRandom());

		// Without a hostname verifier jgit fails to install a new ssl connection factory! 
		// Setting this was key to getting Apache HTTP Client working.
		conn.setHostnameVerifier(HttpsURLConnection.getDefaultHostnameVerifier());
	}

	private TrustManager[] makeTrustManagers(Config config) throws NoSuchAlgorithmException, KeyStoreException, CertificateException, IOException {
		TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
		tmf.init(loadTrustStore());
		return tmf.getTrustManagers();
	}
	
	private KeyStore loadTrustStore() throws IOException, KeyStoreException, NoSuchAlgorithmException, CertificateException {
		File trustStoreFile = new File(Config.computeProfileFolder(), "truststore.jks");
		if (trustStoreFile.canRead()) {
			System.out.println("Reading trustore " + trustStoreFile.getPath());
		} else {
			return null;
		}
		
		try (FileInputStream trust = new FileInputStream(trustStoreFile)) {
			KeyStore r = KeyStore.getInstance(KeyStore.getDefaultType());
			r.load(trust, null);
			return r;
		}
	}
	
}