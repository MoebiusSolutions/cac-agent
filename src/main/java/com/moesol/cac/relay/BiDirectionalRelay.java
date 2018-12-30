package com.moesol.cac.relay;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.net.SocketException;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

import javax.net.ssl.SSLException;

public class BiDirectionalRelay {
	private static final Logger LOGGER = Logger.getLogger(BiDirectionalRelay.class.getName());
	private static int BUFSIZ = 64*1024;
	private final Socket clientSocket;
	private RepairableSocket serverSocket;
	private final SocketSupplier reconnect;
	private final List<Thread> threads = new ArrayList<>();
	
	public interface SocketSupplier {
		Socket get() throws UnknownHostException, IOException;
	}
	
	enum RepairState {
		START,
		READ_REPAIRED,
		WRITE_REPAIRED;
	}
	/**
	 * Repairs a socket by closing down the streams using it and
	 * then reconnecting. This is made a bit more tricky because
	 * the reader and writers must use the same socket when
	 * we are relaying a request/response protocol like https.
	 * To add to this there are two threads, one for reading
	 * and one for writing, so the repair methods must be
	 * synchronized. We use a state machine to track if the
	 * read or write side repairs first. Once both sides have
	 * tried to repair we return to the START state. Finally,
	 * when ever the socker field has been repaired we need
	 * to close the InputStream or OutputStream and re-open
	 * them from the socket.
	 */
	private class RepairableSocket {
		private Socket socket;
		private RepairState state = RepairState.START;
		
		public RepairableSocket(Socket s) {
			this.socket = s;
		}
		public synchronized Socket get() {
			return this.socket;
		}
		public synchronized InputStream readRepair(InputStream is) throws UnknownHostException, IOException {
			switch (state) {
			case START:
				socket = reconnect.get();
				state = RepairState.READ_REPAIRED;
				return rebind(is);
			case READ_REPAIRED: 
				throw new IllegalStateException("Already read repaired");
			case WRITE_REPAIRED: 
				state = RepairState.START; // both sides repaired now
				return rebind(is);
			default:
				throw new IllegalStateException("Unknown state: " + state);
			}
		}
		public synchronized OutputStream writeRepair(OutputStream os) throws UnknownHostException, IOException {
			switch (state) {
			case START:
				socket = reconnect.get();
				state = RepairState.WRITE_REPAIRED;
				return rebind(os);
			case WRITE_REPAIRED: 
				throw new IllegalStateException("Already write repaired");
			case READ_REPAIRED: 
				state = RepairState.START; // both sides repaired now
				return rebind(os);
			default:
				throw new IllegalStateException("Unknown state: " + state);
			}
		}
		private InputStream rebind(InputStream is) throws IOException {
			tryClose(is);
			return socket.getInputStream();
		}
		private OutputStream rebind(OutputStream os) throws IOException {
			tryClose(os);
			return socket.getOutputStream();
		}
	}

	public BiDirectionalRelay(Socket clientSocket, Socket serverSocket, SocketSupplier reconnect) {
		this.clientSocket = clientSocket;
		this.serverSocket = new RepairableSocket(serverSocket);
		this.reconnect = reconnect;
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
				copyFromClientWithOneTimeRetry();
			} finally {
				// clientSocket already closed by now
				maybeClose(serverSocket.get());
			}
		} catch (IOException e) {
			throw new RuntimeException(e);
		}
	}
	
	public void copyFromServer() {
		try {
			try {
				copyFromServerWithOneTimeReconnect();
			} finally {
				// serverSocket is already closed by now
				maybeClose(clientSocket);
			}
		} catch (IOException e) {
			throw new RuntimeException(e);
		}
	}

	private void copyFromClientWithOneTimeRetry() throws IOException {
		Thread.currentThread().setName(String.format("relay-io: %s to %s", clientSocket, serverSocket));
		InputStream is = clientSocket.getInputStream();
		OutputStream os = serverSocket.get().getOutputStream();
		
		try {
			byte[] buffer = new byte[BUFSIZ];
			int len;
			while ((len = is.read(buffer)) != -1) {
				try {
					os.write(buffer, 0, len);
				} catch (SSLException e) {
					LOGGER.log(Level.INFO, "One-time write retry");
					os = serverSocket.writeRepair(os); // rebind will close os
					os.write(buffer, 0, len);
				}
			}
		} catch (SSLException e) {
			LOGGER.log(Level.WARNING, "SSL issue", e);
			// Calling System.exit(1) here works if you have an outer loop running java.
		} catch (SocketException e) {
			if ("Socket closed".equals(e.getMessage())) {
				LOGGER.log(Level.INFO, "Done: {0} to {1}", new Object[] { clientSocket, serverSocket});
				return;
			} else {
				throw e;
			}
		}
	}

	private void copyFromServerWithOneTimeReconnect() throws IOException {
		Thread.currentThread().setName(String.format("relay-io: %s to %s", serverSocket, clientSocket));
		InputStream is = serverSocket.get().getInputStream();
		OutputStream os = clientSocket.getOutputStream();
		
		try {
			byte[] buffer = new byte[BUFSIZ];
			while (true) {
				int len;
				try {
					len = is.read(buffer);
				} catch (SSLException e) {
					LOGGER.log(Level.INFO, "One-time read retry");
					is = serverSocket.readRepair(is); // rebind will close is
					len = is.read(buffer);
				}
				if (len == -1) { // EOF 
					break;
				}
				os.write(buffer, 0, len);
			}
		} catch (SSLException e) {
			LOGGER.log(Level.WARNING, "SSL issue", e);
			// Calling System.exit(1) here works if you have an outer loop running java.
		} catch (SocketException e) {
			if ("Socket closed".equals(e.getMessage())) {
				LOGGER.log(Level.INFO, "Done: {0} to {1}", new Object[] { serverSocket, clientSocket});
				return;
			} else {
				throw e;
			}
		}
	}
	
	public void maybeClose(Socket s) throws IOException {
		if (s.isClosed()) {
			return;
		}
		s.close();
	}

	private void tryClose(InputStream is) {
		try {
			is.close();
		} catch (IOException e) {
			LOGGER.log(Level.INFO, "Closing failed TLS stream, failed", e);
		}
	}
	private void tryClose(OutputStream os) {
		try {
			os.close();
		} catch (IOException e) {
			LOGGER.log(Level.INFO, "Closing failed TLS stream, failed", e);
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
			serverSocket.get().close();
		} catch (IOException e) {
			throw new RuntimeException(e);
		}
	}

}
