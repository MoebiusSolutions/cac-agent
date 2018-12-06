package com.moesol.cac.relay;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.net.SocketException;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

import javax.net.ssl.SSLException;

public class BiDirectionalRelay {
	private static final Logger LOGGER = Logger.getLogger(BiDirectionalRelay.class.getName());
	private static int BUFSIZ = 64*1024;
	private final Socket clientSocket;
	private final Socket serverSocket;
	private final List<Thread> threads = new ArrayList<>();

	public BiDirectionalRelay(Socket clientSocket, Socket serverSocket) {
		this.clientSocket = clientSocket;
		this.serverSocket = serverSocket;
		threads.add(thread(this::copyFromClient));
		threads.add(thread(this::copyFromServer));
		thread(this::cleanUp);
	}

	public Thread thread(Runnable r) {
		Thread thread = new Thread(r, "relay-io");
		thread.start();
		return thread;
	}

	public void copyFromClient() {
		try {
			try {
				copyStream(clientSocket, serverSocket);
			} finally {
				// is is already closed by now
				maybeClose(serverSocket);
			}
		} catch (IOException e) {
			throw new RuntimeException(e);
		}
	}
	
	public void copyFromServer() {
		try {
			try {
				copyStream(serverSocket, clientSocket);
			} finally {
				// toServer is already closed by now
				maybeClose(clientSocket);
			}
		} catch (IOException e) {
			throw new RuntimeException(e);
		}
	}

	public void maybeClose(Socket s) throws IOException {
		if (s.isClosed()) {
			return;
		}
		s.close();
	}

	private void copyStream(Socket src, Socket dst) throws IOException {
		Thread.currentThread().setName(String.format("relay-io: %s to %s", src, dst));
		InputStream is = src.getInputStream();
		OutputStream os = dst.getOutputStream();
		
		try {
			byte[] buffer = new byte[BUFSIZ];
			int len;
			while ((len = is.read(buffer)) != -1) {
				os.write(buffer, 0, len);
			}
		} catch (SSLException e) {
			LOGGER.log(Level.WARNING, "SSL issue, exiting", e);
			System.exit(1);
		} catch (SocketException e) {
			if ("Socket closed".equals(e.getMessage())) {
				LOGGER.log(Level.INFO, "Done: {0} to {1}", new Object[] { src, dst });
				return;
			} else {
				throw e;
			}
		}
	}
	
	private void cleanUp() {
		threads.forEach(t -> {
			try {
				t.join();
			} catch (InterruptedException e) {
				throw new RuntimeException(e);
			}
		});
		try {
			clientSocket.close();
			serverSocket.close();
		} catch (IOException e) {
			throw new RuntimeException(e);
		}
	}

}
